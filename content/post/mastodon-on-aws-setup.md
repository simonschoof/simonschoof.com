+++
author = "Simon Schoof"
title = "Mastodon on AWS: Running on AWS"
date = "2023-03-12"
description = "Running Mastodon on AWS using Pulumi"
tags = [
    "mastodon",
    "infrastructure as code", 
    "pulumi",
    "aws",
    "fsharp"
]
series = "Running Mastodon on AWS"
draft = true
+++
This post is the second part of a two article series on deploying and running a Mastodon instance on AWS. 
The code for this part can be found [here][1].
In this second part we will cover the steps to run Mastodon on AWS using ECS and Fargate.

{{< series "Running Mastodon on AWS" >}} 

### Introduction 

After successfully getting Mastodon running locally in the previous part of this series, we can now set up Mastodon to run on AWS. In the previous part, we wanted to try out Mastodon and get familiar with it. Now we want to run Mastodon in production on AWS. For this purpose, we want to use ESC with Fargate to run Mastodon. As we saw in the previous post and can also read in the [*Run your own server* section][2] of the Mastodon documentation, we need more than just the compute part of AWS to get Mastodon running. We will take the parts from the *Run your own server* documentation and list them here again along with the AWS services and other components that will provide the needed functionality.


{{<table tableWidth="95%">}}
Component | Service 
--------|------
Domain name | social.simonschoof.com: Not hosted on AWS, just using a subdomain on my already existing domain registrar  
Configuration and Secrets | AWS Systems Manager Parameter Store and AWS Secrets Manager
Database | Amazon Aurora Serverless V2
Redis | Elasticache for Redis 
Load Balancer | AWS Application Load Balancer
VPN | AWS VPN
Container Orchestration | ECS and Fargate
E-mail provider | AWS SES
Object storage provider | AWS S3 
CDN | AWS CloudFront
{{</table>}}

In the following sections we will go through the different parts listed in the table above and describe which AWS services or which other components we will use to provide the functionality. For some parts, we will describe the manual steps as the automation overhead was not justified for the small amount of work required for a privately hosted Mastodon instance. 
Again, we will use Pulumi with F# to provide the infrastructure and deploy Mastodon. 

### Architecture

The general architecture in AWS to run Mastodon looks like this:
 
{{<figure2 src="/images/aws_architecture.drawio.svg" class="mastodon-aws-architecture" caption="AWS Architecture for Mastodon" >}}

The general idea was to make the architecture as simple as possible.
Therefore we will use the default VPC, which is public by default, and the default subnets provided by AWS. To secure the services within the VPC we will use security groups for the different services. 

As we can see from the architecture diagram, we will use the following AWS services: 

* **AWS VPN** for the VPN
* **AWS Application Load Balancer** for the load balancer
* **Amazon Aurora Serverless V2** for the database
* **Elasticache for Redis** for Redis
* **ECS and Fargate** for the container orchestration
* **AWS SES** for the e-mail provider
* **AWS S3** for the object storage provider
* **AWS CloudFront** for the CDN
* **AWS Systems Manager Parameter Store** for configuration
* **AWS Secrets Manager** for secrets
* **AWS Certificate Manager** for certificates

As mentioned above we are using the default VPC and subnets provided by AWS. Within the VPC we will provide an Application Load Balancer to route the traffic to the the Web and Streaming containers. As the Web and Streaming container are acccesed by a different port and path, we will use two target groups for the Application Load Balancer. One for the Web container listening on port 3000 and the other for the Streaming container listening on port 4000 and reached via the `/api/v1/streaming` path.
The Application Load Balancer will be secured by a security group that only allows traffic from the Internet. The Web and Streaming containers will be secured by a security group that only allows traffic from the Application Load Balancer and to the PostgreSQL database and Redis. The PostgreSQL database and Redis will be secured by a security group that only allows traffic from the Web and Streaming containers running on ECS and Fargate. 

The Application Load Balancer will only allow https traffic and will redirect http traffic to https. The https traffic will be secured by a certificate from AWS Certificate Manager. The certificate will be requested for the domain name, `social.simonschoof.com`, of the Mastodon instance. 

To allow the Mastodon instance to send e-mails, we will use AWS SES.
AWS SES will be configured to use the domain name of the Mastodon instance as the sender domain. To allow AWS SES to send e-mails for the domain, we will have to verify the domain in AWS SES. AWS SES will be configured to use the SMTP interface to send e-mails. The SMTP credentials will be stored in AWS Secrets Manager.

To store the media files uploaded by the users, we will use AWS S3. As I wanted to keep the bucket private, we will use a CloudFront distribution to serve the media files to the users. AWS CloudFront will be configured to use the subdomain `mastodonmedia.simonschoof.com` and will also only allow https traffic. The certificate for the subdomain will be requested from AWS Certificate Manager.

The configuration for the Mastodon instance will be stored in AWS Systems Manager Parameter Store. The secrets will be stored in AWS Secrets Manager.
The configuration and secrets will be stored as environment variables in the ECS task definition and set during the deployment of the Mastodon instance via Pulumi. 

After this short overview of the architecture, let's dive into the details of the different parts.

### Domain name certificates

As mentioned above, we will use the AWS Certificate Manager to request the certificates for the instance domain name `social.simonschoof.com` and the media file domain name `mastodonmedia.simonschoof.com`. As I already have a domain name registered with a domain registrar, I will not use Route 53 to register the domain name. Instead I will use the DNS validation method to validate the domain names. For this purpose, I will create a CNAME record in the DNS configuration of my domain registrar that points to the DNS name provided by AWS Certificate Manager. For the media file domain which is used as the alternate domain name for the CloudFront distribution, the certificate will be requested in the `us-east-1` region which is an [requirement for CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html).
This is For the instance domain name, the certificate will be requested in the `eu-central-1` region, which is the region I am using for all the other resources. The creation of the certificates is done manually and not via Pulumi. 

### SES

Another part of the application where I did not use Pulumi was the setup of the AWS SES service. The setup of AWS SES is quite simple and is described in the [AWS SES documentation](https://docs.aws.amazon.com/ses/latest/DeveloperGuide/send-email-set-up.html). The SMTP credentials can be created manually in the AWS SES console. The SMTP credentials will be stored in AWS Secrets Manager from where they will be retrieved during the deployment of the Mastodon instance as we will see later in the [configuration and secrets section](#configuration-and-secrets). The SES credentials to be created are unique per region. When you start using AWS SES you will be in the sandbox mode. In the sandbox mode you can only send e-mails to verified e-mail addresses. To send e-mails to unverified e-mail addresses, you have to request production access. This is also described in the [AWS SES documentation](https://docs.aws.amazon.com/ses/latest/DeveloperGuide/request-production-access.html). In the setup of a single user instance configuration, there is no need to request production access as the only e-mail the instance will write to is the e-mail of my admin user account. So I only verified the e-mail address of my admin user account. 

### VPN and Security Groups


### PostgreSQL and Redis

###### PostgreSQL

```fsharp
let createRdsCluster () =
    let clusterServerlessv2ScalingConfigurationArgs =
        ClusterServerlessv2ScalingConfigurationArgs(MaxCapacity = 1.0, MinCapacity = 0.5)
    let cluster =
        let clusterArgs =
            ClusterArgs(
                ClusterIdentifier = prefixMastodonResource "rds-cluster-identifier",
                Engine = "aurora-postgresql",
                EngineMode = "provisioned",
                EngineVersion = "14.5",
                DatabaseName = "mastodon",
                MasterUsername = "postgres",
                MasterPassword = io (Output.CreateSecret rdsDbMasterPassword),
                SkipFinalSnapshot = false,
                FinalSnapshotIdentifier = "mastodon-rds-final-snapshot",
                ApplyImmediately = true,
                DeletionProtection = true,
                Serverlessv2ScalingConfiguration = clusterServerlessv2ScalingConfigurationArgs,
                VpcSecurityGroupIds = inputList [ io rdsSecurityGroup.Id ]
            )
        Cluster(prefixMastodonResource "rds-cluster", clusterArgs)
    let clusterInstanceArgs =
        ClusterInstanceArgs(
            ClusterIdentifier = cluster.Id,
            InstanceClass = "db.serverless",
            Engine = cluster.Engine,
            EngineVersion = cluster.EngineVersion
        )
    
    ClusterInstance(prefixMastodonResource "rds-cluster-instance", clusterInstanceArgs) |> ignore
    ()
```

###### Redis

```fsharp
let createElastiCacheCluster () =
    let clusterArgs = ClusterArgs(
        Engine = "redis",
        EngineVersion = "7.0",
        NodeType = "cache.t3.micro",
        NumCacheNodes = 1,
        ParameterGroupName = "default.redis7",
        Port = 6379,
        ApplyImmediately = true,
        SecurityGroupIds = inputList [ io elasticacheSecurityGroup.Id ]
    )
    Cluster(prefixMastodonResource "elasticache-cluster", clusterArgs) |> ignore
    ()
```

### ESC with Fargate

### S3 and CloudFront

##### Manual steps

Create user and add it to the group we created. Export the access key and secret key store them in the AWS Secrets Manager from which we will read them in the Pulumi deployment.

### Configuration and Secrets

### Deploymenent and Maintenance

```fsharp
module Program

open MastodonAwsServices.ElastiCache
open MastodonAwsServices.Rds
open MastodonAwsServices.S3AndCloudFront
open MastodonAwsServices.Ecs
open Pulumi.FSharp

let infra () =

  createBucketAndDistribution () 
  createRdsCluster ()
  createElastiCacheCluster ()
  createEcs ()
  
  dict []

[<EntryPoint>]
let main _ =
  Deployment.run infra
```

[1]: https://github.com/simonschoof/mastodon-aws/tree/main/infrastructure/aws-services
[2]: https://docs.joinmastodon.org/user/run-your-own/#so-you-want-to-run-your-own-mastodon-server