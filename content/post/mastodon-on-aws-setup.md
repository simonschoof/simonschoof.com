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
VPC | AWS VPC
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

* **AWS VPC** for the VPC
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

### Domain name and certificates

As mentioned above, we will use the AWS Certificate Manager to request the certificates for the instance domain name `social.simonschoof.com` and the media file domain name `mastodonmedia.simonschoof.com`. As I already have a domain name registered with a domain registrar, I will not use Route 53 to register the domain name. Instead I will use the DNS validation method to validate the domain names. For this purpose, I will create a CNAME record in the DNS configuration of my domain registrar that points to the DNS name provided by AWS Certificate Manager. For the media file domain which is used as the alternate domain name for the CloudFront distribution, the certificate will be requested in the `us-east-1` region which is an [requirement for CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html).
This is For the instance domain name, the certificate will be requested in the `eu-central-1` region, which is the region I am using for all the other resources. The creation of the certificates is done manually and not via Pulumi. 

### SES

Another part of the application where I did not use Pulumi was the setup of the AWS SES service. The setup of AWS SES is quite simple and is described in the [AWS SES documentation](https://docs.aws.amazon.com/ses/latest/DeveloperGuide/send-email-set-up.html). The SMTP credentials can be created manually in the AWS SES console. The SMTP credentials will be stored in AWS Secrets Manager from where they will be retrieved during the deployment of the Mastodon instance as we will see later in the [configuration and secrets section](#configuration-and-secrets). The SES credentials to be created are unique per region. When you start using AWS SES you will be in the sandbox mode. In the sandbox mode you can only send e-mails to verified e-mail addresses. To send e-mails to unverified e-mail addresses, you have to request production access. This is also described in the [AWS SES documentation](https://docs.aws.amazon.com/ses/latest/DeveloperGuide/request-production-access.html). In the setup of a single user instance configuration, there is no need to request production access as the only e-mail the instance will write to is the e-mail of my admin user account. So I only verified the e-mail address of my admin user account. 

### VPC and security groups

To run Mastodon in AWS we will need a network infrastructure to run the different services. As mentioned above, we will use the default VPC and subnets provided by AWS. To secure the services within the VPC we will use security groups for the different services. For a single user Mastodon instance this setup seems to be sufficient. For a multi user instance, you might want to consider using a private subnet for the database and Redis as recommended by AWS. The VPC and security groups will be created via Pulumi. Whereas the default VPC and subnets are automatically created by AWS when you create an AWS account. 

Defining the default VPC and subnets in Pulumi will add both to the Pulumi stack and are not managed by Pulumi. Removing the default VPC and subnets from the Pulumi stack will not remove them from AWS. To add the default VPC and subnets to the Pulumi stack we just have to write down the following code<cite>[^1]<cite>:

     
```fsharp
let defaultVpc = DefaultVpc("default-vpc")

let defaultSubnets =
    let subnetInvokeArgs =
        GetSubnetsInvokeArgs(
            Filters =
                inputList [ input (
                                GetSubnetsFilterInputArgs(Name = "vpc-id", Values = inputList [ io defaultVpc.Id ])
                            ) ]
        )
    GetSubnets.Invoke(subnetInvokeArgs)

let defaultSubnetIds = 
    List.init 3 (fun n -> defaultSubnets.Apply(fun subnets -> subnets.Ids.[n]))
```

After this we can define the security groups for the different services. There will be a security group for: 

* The AWS Aurora PostgreSQL database
* The Redis database
* The AWS ECS Fargate service 
* The Application Load Balancer


```fsharp
let rdsSecurityGroup =
    let rdsSecurityGroupArgs =
        SecurityGroupArgs(Description = "Allow inbound traffic from ECS to RDS")
    SecurityGroup(prefixMastodonResource "rds-security-group", rdsSecurityGroupArgs)

let elasticacheSecurityGroup =
    let elasticacheSecurityGroupArgs =
        SecurityGroupArgs(Description = "Allow inbound traffic from ECS to Elasticache")
    SecurityGroup(prefixMastodonResource "elasticache-security-group", elasticacheSecurityGroupArgs)

let ecsSecurityGroup =
    let ecsSecurityGroupArgs =
        SecurityGroupArgs(Description = "Ecs Security Group")
    SecurityGroup(prefixMastodonResource "ecs-security-group", ecsSecurityGroupArgs)

let loadBalancerSecurityGroup = 
    let loadBalancerSecurityGroupArgs = 
        SecurityGroupArgs(Description = "Loadbalancer Security Group")
    SecurityGroup(prefixMastodonResource "loadbalancer-security-group", loadBalancerSecurityGroupArgs)
```

After defining the security groups, we can add the rules to the security groups.
We can add security group rules to the security groups for inbound and outbound traffic. First we will define the inbound rules for the security groups. The inbound rules for the security groups are defined as follows:

* The RDS security group allows inbound traffic from the ECS security group on port 5432.
* The Elasticache security group allows inbound traffic from the ECS security group on port 6379.
* The ECS security group allows inbound traffic from the load balancer security group on port 3000 and 4000 for the Mastodon web and streaming service.
* The load balancer security group allows inbound traffic from the internet on port 80 and 443 for the Mastodon web service. The inbound traffic on port 80 will be redirected to port 443 as we will see later in the [load balancer section](#load-balancer).

```fsharp
let rdsSecurityGroupInboundRule =
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = rdsSecurityGroup.Id,
            Type = "ingress",
            FromPort = 5432,
            ToPort = 5432,
            Protocol = "tcp",
            SourceSecurityGroupId = ecsSecurityGroup.Id
        )
    SecurityGroupRule(prefixMastodonResource "rds-inbound-tcp-security-group-rule", securityGroupRuleArgs)

let elastiCacheSecurityGroupInboundRule =
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = elasticacheSecurityGroup.Id,
            Type = "ingress",
            FromPort = 6379,
            ToPort = 6379,
            Protocol = "tcp",
            SourceSecurityGroupId = ecsSecurityGroup.Id
        )
    SecurityGroupRule(prefixMastodonResource "elasticache-inbound-tcp-security-group-rule", securityGroupRuleArgs)

let ecsSecurityGroupIp4MastodonWebTrafficInboundRule =
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = ecsSecurityGroup.Id,
            Type = "ingress",
            FromPort = 3000,
            ToPort = 3000,
            Protocol = "tcp",
            SourceSecurityGroupId = loadBalancerSecurityGroup.Id)
    SecurityGroupRule(prefixMastodonResource "ecs-inbound-mastodon-web-ip4-security-group-rule", securityGroupRuleArgs)

let ecsSecurityGroupIp4MastodonStreamingTrafficInboundRule =
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = ecsSecurityGroup.Id,
            Type = "ingress",
            FromPort = 4000,
            ToPort = 4000,
            Protocol = "tcp",
            SourceSecurityGroupId = loadBalancerSecurityGroup.Id)
    SecurityGroupRule(prefixMastodonResource "ecs-inbound-mastodon-streaming-ip4-security-group-rule", securityGroupRuleArgs)

let loadBalancerSecurityGroupIp4HttpTrafficInboundRule =
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = loadBalancerSecurityGroup.Id,
            Type = "ingress",
            FromPort = 80,
            ToPort = 80,
            Protocol = "tcp",
            CidrBlocks = inputList [ input "0.0.0.0/0"] )
    SecurityGroupRule(prefixMastodonResource "loadbalancer-inbound-http-security-group-rule", securityGroupRuleArgs)

let loadBalancerSecurityGroupIp4HttpsTrafficInboundRule =
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = loadBalancerSecurityGroup.Id,
            Type = "ingress",
            FromPort = 443,
            ToPort = 443,
            Protocol = "tcp",
            CidrBlocks = inputList [ input "0.0.0.0/0"] )
    SecurityGroupRule(prefixMastodonResource "loadbalancer-inbound-https-security-group-rule", securityGroupRuleArgs)
```

After defining the inbound rules for the security groups, we can define the outbound rules for the security groups. The outbound rules for the security groups are defined as follows:

* The load balancer security group allows outbound traffic to port 3000 and 4000 for the Mastodon web and streaming service running on the ECS service.
* The ECS security group allows outbound traffic to the RDS security group on port 5432 for the PostgreSQL database.
* The ECS security group allows outbound traffic to the Elasticache security group on port 6379 for the Redis database.
* The ECS security group allows outbound traffic to the internet on port 80 and 443 for the Mastodon web and streaming service.
* The ECS security group allows outbound traffic to SES on port 587 for sending emails.

```fsharp
let loadBalancerSecurityGroupIp4WebTcpOutboundRule = 
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = loadBalancerSecurityGroup.Id,
            Type = "egress",
            FromPort = 3000,
            ToPort = 3000,
            Protocol = "tcp",
            CidrBlocks = inputList [ input "0.0.0.0/0" ])
    SecurityGroupRule(prefixMastodonResource "loadbalancer-outbound-all-web-ip4-security-group-rule", securityGroupRuleArgs)

let loadBalancerSecurityGroupIp4StreamingTcpOutboundRule = 
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = loadBalancerSecurityGroup.Id,
            Type = "egress",
            FromPort = 4000,
            ToPort = 4000,
            Protocol = "tcp",
            CidrBlocks = inputList [ input "0.0.0.0/0" ])
    SecurityGroupRule(prefixMastodonResource "loadbalancer-outbound-all-streaming-ip4-security-group-rule", securityGroupRuleArgs)

let ecsSecurityGroupIp4RdsTcpOutboundRule = 
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = ecsSecurityGroup.Id,
            Type = "egress",
            FromPort = 5432,
            ToPort = 5432,
            Protocol = "tcp",
            CidrBlocks = inputList [ input "0.0.0.0/0" ])
    SecurityGroupRule(prefixMastodonResource"ecs-outbound-rds-tcp-ip4-security-group-rule", securityGroupRuleArgs)

let ecsSecurityGroupIp4RedisTcpOutboundRule = 
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = ecsSecurityGroup.Id,
            Type = "egress",
            FromPort = 6379,
            ToPort = 6379,
            Protocol = "tcp",
            CidrBlocks = inputList [ input "0.0.0.0/0" ])
    SecurityGroupRule(prefixMastodonResource"ecs-outbound-redis-tcp-ip4-security-group-rule", securityGroupRuleArgs)

let ecsSecurityGroupIp4SmtpTcpOutboundRule = 
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = ecsSecurityGroup.Id,
            Type = "egress",
            FromPort = int smtpPort,
            ToPort = int smtpPort,
            Protocol = "tcp",
            CidrBlocks = inputList [ input "0.0.0.0/0" ])
    SecurityGroupRule(prefixMastodonResource"ecs-outbound-smtp-tcp-ip4-security-group-rule", securityGroupRuleArgs)

let ecsSecurityGroupIp4HttpTcpOutboundRule = 
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = ecsSecurityGroup.Id,
            Type = "egress",
            FromPort = 80,
            ToPort = 80,
            Protocol = "tcp",
            CidrBlocks = inputList [ input "0.0.0.0/0" ])
    SecurityGroupRule(prefixMastodonResource"ecs-outbound-http-tcp-ip4-security-group-rule", securityGroupRuleArgs)

let ecsSecurityGroupIp4HttpsTcpOutboundRule = 
    let securityGroupRuleArgs =
        SecurityGroupRuleArgs(
            SecurityGroupId = ecsSecurityGroup.Id,
            Type = "egress",
            FromPort = 443,
            ToPort = 443,
            Protocol = "tcp",
            CidrBlocks = inputList [ input "0.0.0.0/0" ])
    SecurityGroupRule(prefixMastodonResource"ecs-outbound-https-tcp-ip4-security-group-rule", securityGroupRuleArgs)
```

### PostgreSQL and Redis

After defining the VPC, the subnets, the security groups, and the security group rules, we can start to add the resources that will be deployed in the VPC. The first resources that we will add are the PostgreSQL and Redis databases. 

##### PostgreSQL

For the PostgreSQL database I decided to try the AWS Aurora serverless v2 version which is, according to AWS, [a good fit for development and testing environments][3] because we can  define a low minimum capacity for the database. Defining the PostgreSQL database is straigthforward and it is defined as follows:

```fsharp
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
```

To use the Aurora serverless v2 version we need to define the `EngineMode` as `provisioned` and provide the `Serverlessv2ScalingConfiguration` argument. I also set the deletion protection to `true` to prevent the database from being deleted by accident. Furthermore, I set the `SkipFinalSnapshot` argument to `false` and provide a `FinalSnapshotIdentifier` to create a final snapshot of the database when it is deleted. The last thin g to point out is that I set the `ApplyImmediately` argument to `true` to apply changes immediately and not wait for the next maintenance window.


##### Redis

The Redis database is even easier to define than the PostgreSQL database. The Redis database is defined as follows where I chose the smallest instance type `cache.t3.micro` and the latest Redis version `7.0`:

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

As in the case of the PostgreSQL database, I set the `ApplyImmediately` argument to `true` to apply changes immediately and not wait for the next maintenance window.

### ALB, container task definitions and ECS with Fargate

The next step is to define the Application Load Balancer (ALB), the Elastic Container Service (ECS) and the Fargate tasks. This is, next to the S3 Bucket and CloudFront distribution, the most complex part of the deployment. We will go through the different parts step by step starting with the ALB. For the Pulumi code in this section we use the classic AWS package `Pulumi.Aws` as well as the AWS crosswalk package `Pulumi.Awsx`. When using the crosswalk package we will use the qualified name `Awsx` to avoid name clashes with the classic AWS package. 
##### ALB

Before we can start to define the ALB we need to get the certificate for the Mastodon instance domain:

```fsharp
let cert =
    let getCertificateInvokeArgs =
        GetCertificateInvokeArgs(
            Domain = localDomain,
            MostRecent = true,
            Types = inputList [ input "AMAZON_ISSUED" ]
    )
    GetCertificate.Invoke(getCertificateInvokeArgs)
```

With the certificate at hand we can start to define the ALB itself:

```fsharp
let loadBalancerArgs = LoadBalancerArgs(
    IpAddressType = "ipv4",
    LoadBalancerType = "application",
    SecurityGroups = inputList [ io loadBalancerSecurityGroup.Id],
    Subnets = inputList (defaultSubnetIds |> List.map io)

let loadBalancer = LoadBalancer(prefixMastodonResource "load-balancer", loadBalancerArgs)
```

In addition to the load balancer itself we define two target groups. Target groups are used to route requests to the different services that are running in the ECS cluster. In our case we define one target group for the Mastodon web application listening on port `3000` and one target group for the Mastodon  streaming application listening on port `4000`:

```fsharp
let webTargetGroupArgs =
    TargetGroupArgs(
        TargetType = "ip",
        Port = 3000,
        Protocol = "HTTP",
        VpcId = defaultVpc.Id,
        HealthCheck = TargetGroupHealthCheckArgs(Interval = 30, Path = "/health")
        
let webTargetGroup = TargetGroup(prefixMastodonResource "web-tg", webTargetGroupArgs

let streamingTargetGroupArgs =
    TargetGroupArgs(
        TargetType = "ip",
        Port = 4000,
        Protocol = "HTTP",
        VpcId = defaultVpc.Id,
        HealthCheck = TargetGroupHealthCheckArgs(Interval = 30, Path = "/api/v1/streaming/health")
    )

let streamingTargetGroup = TargetGroup(prefixMastodonResource "streaming-tg", streamingTargetGroupArgs)
```

As mentioned before the http requests on port 80 are redirected to port 443. To reflect this in AWS with Pulumi we define a http listener as follows:

```fsharp
let httpDefaultAction =
    ListenerDefaultActionArgs(
        Type = "redirect",
        Redirect =
            ListenerDefaultActionRedirectArgs(
                Port = "443",
                Protocol = "HTTPS",
                StatusCode = "HTTP_301"
            )
    )

let httpListenerArgs = ListenerArgs(
        LoadBalancerArn = loadBalancer.Arn,
        Port = 80, 
        Protocol = "HTTP",
        DefaultActions = inputList [ input httpDefaultAction ]
    )

Listener(prefixMastodonResource "http-listener", httpListenerArgs) |> ignore
```

In the listener args we connect the listener to the load balancer and define the default action to redirect the requests to port 443. To handle the https requests we define a https listener which is connected to the load balancer and the certificate we retrieved at the beginning of this section:

```fsharp
let httpsDefaultAction =
    ListenerDefaultActionArgs(
        Type = "forward",                
        TargetGroupArn = webTargetGroup.Arn
    
let httpsListenerArgs = 
    ListenerArgs(
        LoadBalancerArn = loadBalancer.Arn,
        Port = 443,
        Protocol = "HTTPS",
        SslPolicy = "ELBSecurityPolicy-2016-08",
        CertificateArn = io (cert.Apply(fun cert -> cert.Arn)),
        DefaultActions =  inputList [ input httpsDefaultAction ]
    )

let httpsListener = Listener(prefixMastodonResource "https-listener", httpsListenerArgs)
```

The streaming application is reachable on port 4000 and the path `/api/v1/streaming`. To get the correct routing we have to define a rule for the streaming target group:

```fsharp
let listRuleConditionPathPatternArgs = ListenerRuleConditionPathPatternArgs(
    Values = inputList  [ input "/api/v1/streaming"]

let listenerRuleConditionArgs = ListenerRuleConditionArgs(
    PathPattern = listRuleConditionPathPatternArgs

let listenerRuleActionArgs = ListenerRuleActionArgs(
    Type = "forward",
    TargetGroupArn = streamingTargetGroup.Arn

let listenerRuleArgs = ListenerRuleArgs(
    ListenerArn = httpsListener.Arn,
    Priority = 1,
    Conditions = inputList [input listenerRuleConditionArgs ],
    Actions = inputList [input listenerRuleActionArgs]

ListenerRule(prefixMastodonResource "streaming-api-path-rule",listenerRuleArgs) |> ignore
```

##### Container task definitions

With the ALB in place we can start to define the container task definitions. The task definitions are used to define the containers that are running in the ECS cluster. In our case we define four task definitions, one for the Mastodon web application, one for the Mastodon streaming application, one for the Mastodon Sidekiq application and one optional task definition for PostgreSQL for maintenance and debugging purposes.

All task definitions are stored in a list which is later provided to the Fargate service:

```fsharp
let containerDefinitionsList =
    System.Collections.Generic.Dictionary<string, Awsx.Ecs.Inputs.TaskDefinitionContainerDefinitionArgs>()
```

We stat with defining the PostgreSQL task definition. The PostgreSQL task definition is optional and can be used for maintenance and debugging purposes. We will only spin up the PostgreSQL task definition if the `runMode` is set to `Debug` or `Maintenance`:

```fsharp
let postgresContainer = 
    match runMode with
        | Maintenance | Debug -> 
            let taskDefinitionContainerDefinitionArgs =
                Awsx.Ecs.Inputs.TaskDefinitionContainerDefinitionArgs(
                    Image = "postgres:latest",
                        Command =
                            inputList [ input "bash"
                                        input "-c"
                                        input "while true; do sleep 3600; done" ],
                        Essential = false
                    
            containerDefinitionsList.Add("psql", taskDefinitionContainerDefinitionArgs)
            ()
        | Production -> ()
```

The PostgreSQL container is based on the `postgres:latest` image and runs a bash script that sleeps for 3600 seconds. This is done to keep the container running. The PostgreSQL container is not essential and will not be restarted if it fails. This is done to prevent the PostgreSQL container from restarting if the database is not available.

Next we define the Mastodon web application container. For the web application we define a container port mapping for port `3000` in which we map the port to the `webTargetGroup` we defined earlier. We also define a container command that starts the Mastodon web application. The container command is different depending on the `runMode`. For `Maintenance` and `Debug` we start a bash script that sleeps for 3600 seconds so that we can connect to the container and debug the application. For `Production` we start the Mastodon web application. The container is configured via environment variables that are required for Mastodon. How these environment variables are defined is explained in the section [Configuration and secrets](#configuration-and-secrets):

```fsharp
let webContainerportMappingArgs =
    Awsx.Ecs.Inputs.TaskDefinitionPortMappingArgs(ContainerPort = 3000, TargetGroup = webTargetGroup

let webContainerCommand = 
    match runMode with
    | Maintenance | Debug -> inputList [ input "bash"; input "-c"; input "while true; do sleep 3600; done" ]
    | Production ->  inputList [ input "bash"; input "-c"; input "rm -f /mastodon/tmp/pids/server.pid; bundle exec rails s -p 3000" ]

let webContainer =
    Awsx.Ecs.Inputs.TaskDefinitionContainerDefinitionArgs(
        Image = mastodonImage,
        Command = webContainerCommand,
        Cpu = 256,
        Memory = 512,
        Essential = true,
        Environment = mastodonContainerEnvVariables,
        PortMappings = inputList [ input webContainerportMappingArgs ]
    
containerDefinitionsList.Add(prefixMastodonResource "web", webContainer)
```

In analogy to the web application container we define the Mastodon streaming application container. Again we define a port mapping which maps port `4000` to the `streamingTargetGroup`. Teh container command starts the Mastodon streaming application as a node application. The container is also configured with the environment variables that are required for Mastodon:

```fsharp
let streamingContainerportMappingArgs =
    Awsx.Ecs.Inputs.TaskDefinitionPortMappingArgs(ContainerPort = 4000, TargetGroup = streamingTargetGroup

let streamingContainer = Awsx.Ecs.Inputs.TaskDefinitionContainerDefinitionArgs(
    Image = mastodonImage,
    Command =
        inputList [ input "bash"
                    input "-c"
                    input "node ./streaming" ],
    Cpu = 256,
    Memory = 256,
    Essential = true,
    Environment = mastodonContainerEnvVariables,
    PortMappings = inputList[ input streamingContainerportMappingArgs ]

containerDefinitionsList.Add(prefixMastodonResource "streaming",streamingContainer)
```

The last container we define is the Mastodon Sidekiq application container. The Sidekiq application is used for background processing. The Sidekiq application is also configured with the environment variables that are required for Mastodon. For the Sidekiq application we don't define a port mapping as the Sidekiq application is not reachable from the outside and only communicates with the Mastodon web application over the internal network of the Fargate service:

```fsharp
let sidekiqContainer = Awsx.Ecs.Inputs.TaskDefinitionContainerDefinitionArgs(
    Image = mastodonImage,
    Command =
        inputList [ input "bash"
                    input "-c"
                    input "bundle exec sidekiq" ],
    Cpu = 256,
    Memory = 256,
    Environment = mastodonContainerEnvVariables,
    Essential = true

containerDefinitionsList.Add(prefixMastodonResource "sidekiq",sidekiqContainer)
```

##### ECS with Fargate

After finishing the container task definitions we can start to define ECS cluster using Fargate as the compute engine.

First we define the ECS cluster to logically group the containers that are running in the ECS cluster. Here we also set the capicity provider to `FARGATE_SPOT` in the hope that it will save us some money:

```fsharp
let clusterArgs = ClusterArgs(
    CapacityProviders = inputList [input "FARGATE_SPOT"]
)

let cluster =
    Cluster(prefixMastodonResource "ecs-cluster", clusterArgs)
```

In the second step we prepare a task role which allows us to connect to the containers in the ECS cluster. To do this we need an assume role policiy and a task policy which allows us to connect to the containers in the ECS cluster:

```fsharp
let assumeRolePolicy =
    @"{
    ""Version"": ""2012-10-17"",
    ""Statement"": [
        {
            ""Effect"": ""Allow"",
            ""Principal"": {
                ""Service"": ""ecs-tasks.amazonaws.com""
            },
            ""Action"": ""sts:AssumeRole""
        }
    ]
}

let policiy =
    @"{
            ""Version"": ""2012-10-17"",
            ""Statement"": [
                {
                    ""Effect"": ""Allow"",
                    ""Action"": [
                        ""ssmmessages:CreateControlChannel"",
                        ""ssmmessages:CreateDataChannel"",
                        ""ssmmessages:OpenControlChannel"",
                        ""ssmmessages:OpenDataChannel""
                    ],
                    ""Resource"": ""*""
                }
            ]
        }

let taskPolicy =
    Policy(prefixMastodonResource "task-policy", PolicyArgs(PolicyDocument = policiy)

let taskRole =
    Role(
        prefixMastodonResource "task-role",
        RoleArgs(AssumeRolePolicy = assumeRolePolicy, ManagedPolicyArns = inputList [ io taskPolicy.Arn ])
    
let defaultTaskRoleWithPolicy =
    Awsx.Awsx.Inputs.DefaultRoleWithPolicyArgs(RoleArn = taskRole.Arn)
```

The third step comprises the Fargate service definition leveraging the task definitions and the ECS cluster we defined in the previous steps using the the simplified Fargate service definition provided by the `Awsx` library. We also see that we only add the task role with the policy to the Fargate service definition if we are in maintenance or debug mode. In production mode we don't need the task role with the policy as we don't want to connect to the containers in production mode. We also define the network configuration for the Fargate service. Here we set the `AssignPublicIp` property to `true` to make the containers reachable from the outside. To prevent the containers from being reachable from the outside we set the ecs security group which we defined earlier in the section about the [VPC and security groups](#vpc-and-security-groups). Another property which is only set in maintenance and debug mode is the `EnableExecuteCommand` property which is also neededto connect to the containers in the ECS cluster using the AWS Systems Manager Session Manager:

```fsharp
let fargateServiceTaskDefinitionArgs =
    match runMode with 
        | Maintenance | Debug -> Awsx.Ecs.Inputs.FargateServiceTaskDefinitionArgs(
            Containers = containerDefinitionsList,
            TaskRole = defaultTaskRoleWithPolicy
            )
        | Production -> Awsx.Ecs.Inputs.FargateServiceTaskDefinitionArgs(
            Containers = containerDefinitionsList
            
let networkConfiguration =
    ServiceNetworkConfigurationArgs(
        AssignPublicIp = true,
        Subnets = inputList (defaultSubnetIds |> List.map io),
        SecurityGroups = inputList [ io ecsSecurityGroup.Id ]
    
let enableExecutCommand = 
    match runMode with
         | Maintenance | Debug -> true
         | Production -> fals

let serviceArgs =
    Awsx.Ecs.FargateServiceArgs(
        Cluster = cluster.Arn,
        DesiredCount = 1,
        EnableExecuteCommand = enableExecutCommand,
        TaskDefinitionArgs = fargateServiceTaskDefinitionArgs,
        NetworkConfiguration = networkConfiguration
    
Awsx.Ecs.FargateService(prefixMastodonResource "fargate-service", serviceArgs) |> ignore
```

### S3 and CloudFront 

An optional piece, as to the Mastodon documentation, is an Object storage provider. As we will run Mastodon in Docker containers we need to use an external object storage provider for which we will use AWS S3. In addition to the bucket itself we will also create a CloudFront distribution to serve the user-uploaded files from the S3 bucket. With the CloudFront distribution we also can use a custom domain name to serve the user-uploaded files. With the custom domain  we also don't have to worry about breaking links to the user-uploaded files when we change the object storage provider. Another advantage of using CloudFront is that we don't have to make the S3 bucket being publicly accessible as we can restrict the access to the S3 bucket to the CloudFront distribution. 

##### S3 bucket

For Mastodon to acccess the S3 bucket we have to provide Mastodon with an AWS access key id and an AWS access key id secret. As it is not quite clear from the Mastodon documentation which permissions are needed by Mastodon to access the S3 bucket I followed the approach of Daniel Snider which he describes in [this GitHub gist][4]. Part of this I also configure manually in the AWS console. The parts which I configured manually in the AWS console are creating the user `mastodon-s3-user` and adding this user to the group `mastodon-s3-access-group` which we will create in the Pulumi deployment. I also created the access key and secret key for the user `mastodon-s3-user` and stored them in the AWS Secrets Manager.

First we will create the bucket and  we will block the all public access to it:

```fsharp
let bucket =
    
    let bucketName = prefixMastodonResource "s3-storage"
    let bucketArgs = BucketArgs(Acl = "private")
    
    Bucket(bucketName, bucketArgs)

let bucketPublicAccessBlock =
    let bucketPublicAccessBlockArgs = 
        BucketPublicAccessBlockArgs(
            Bucket = bucket.Id,
            BlockPublicAcls = true,
            BlockPublicPolicy = true,
            IgnorePublicAcls = true,
            RestrictPublicBuckets = true
        )
    
    BucketPublicAccessBlock(prefixMastodonResource "s3-storage-public-access-block", bucketPublicAccessBlockArgs)
```

After this we can create the S3 access group, a policy document, a policy and the policy attachment for this group:

```fsharp
let limitedPermissionsToOneBucketStatement =
    GetPolicyDocumentStatementInputArgs(
        Effect = "Allow",
        Actions =
            inputList [ input "s3:ListBucket"
                        input "s3:GetBucketLocation" ],
        Resources = inputList [ io bucket.Arn ]
    )
    
let permissionsToBucketStatement =
    GetPolicyDocumentStatementInputArgs(
        Effect = "Allow",
        Actions =
            inputList [ input "s3:GetObject"
                        input "s3:GetObjectAcl"
                        input "s3:PutObject"
                        input "s3:PutObjectAcl"
                        input "s3:DeleteObject"
                        input "s3:AbortMultipartUpload"
                        input "s3:ListMultipartUploadParts" ],
        Resources = inputList [ io (Output.Format($"{bucket.Arn}/*")) ]
    )

let policyDocumentInvokeArgs =
    GetPolicyDocumentInvokeArgs(
        Statements =
            inputList [ input limitedPermissionsToOneBucketStatement
                        input permissionsToBucketStatement ]
    )

let policyDocument =
    GetPolicyDocument.Invoke(policyDocumentInvokeArgs)

let policyArgs = PolicyArgs(PolicyDocument = io (policyDocument.Apply(fun (pd) -> pd.Json)))

let policy = Policy(prefixMastodonResource "s3-access-policiy", policyArgs)

let group = Group(prefixMastodonResource "s3-access-group")

let policyAttachmentArgs = PolicyAttachmentArgs(Groups = group.Name, PolicyArn = policy.Arn)

PolicyAttachment(prefixMastodonResource "access-group-policiy-attachment", policyAttachmentArgs)
```

We can now add the user `mastodon-s3-user` to the group `mastodon-s3-access-group` we created above. Again, this step is done manually in the AWS console.
From here we only have to provide the access key id and the access key id secret to Mastodon and we are able to store the user-uploaded files in the S3 bucket.

##### CloudFront distribution

For the CloudFront distribution we first define the origin acccess identity and a bucket policy for the S3 bucket so that we allow CloudFront to retrieve objects from the S3 bucket:

```fsharp
let originAccessIdentity =
    let originAccessIdentityArgs =
        OriginAccessIdentityArgs(Comment = "Access identy to access the origin bucket")
    OriginAccessIdentity("Cloudfront Origin Access Identity", originAccessIdentityArgs)

let cloudFrontPrincipal =
    GetPolicyDocumentStatementPrincipalInputArgs(
        Type = "AWS",
        Identifiers = inputList [ io originAccessIdentity.IamArn ]
    )

let imageBucketPolicy =
    
    let getObjectStatement =
        GetPolicyDocumentStatementInputArgs(
            Principals = inputList [ input cloudFrontPrincipal ],
            Actions = inputList [ input "s3:GetObject" ],
            Resources =
                inputList [ io bucket.Arn
                            io (Output.Format($"{bucket.Arn}/*")) ]
        )
    
    let policyDocumentInvokeArgs =
        GetPolicyDocumentInvokeArgs(
            Statements =
                inputList [ input getObjectStatement ]
        )
    
    let policyDocument =
        GetPolicyDocument.Invoke(policyDocumentInvokeArgs)
    
    let bucketPolicyArgs =
        BucketPolicyArgs(Bucket = bucket.Id, Policy = io (policyDocument.Apply(fun (pd) -> pd.Json)))

    BucketPolicy(prefixMastodonResource "image-bucket-policy", bucketPolicyArgs)
```

To support HTTPS we also need to retrieve the certificate for the S3 alias host domain we created with the AWS Certificate Manager.For CloudFront this certificate has to be stored in the us-east-1 region:

```fsharp
let cert =
    
    let certInvokeOptions =
        let invokeOptions = InvokeOptions()
        invokeOptions.Provider <- Provider("useast1", ProviderArgs(Region = "us-east-1"))
        invokeOptions
    
    let getCertificateInvokeArgs =
        GetCertificateInvokeArgs(
            Domain = s3AliasHost,
            MostRecent = true,
            Types = inputList [ input "AMAZON_ISSUED" ]
        )
        
    GetCertificate.Invoke(getCertificateInvokeArgs, certInvokeOptions)
```

In the end we can create the CloudFront distribution with the certificate, the S3 alias host domain and the S3 bucket as origin:

```fsharp
let cloudFrontDistribution = 

    let s3OriginConfigArgs = DistributionOriginS3OriginConfigArgs(OriginAccessIdentity = originAccessIdentity.CloudfrontAccessIdentityPath)

    let originArgs =
        DistributionOriginArgs(
            DomainName = bucket.BucketRegionalDomainName,
            OriginId = "myS3Origin",
            S3OriginConfig = s3OriginConfigArgs
        )

    let viewerCertificate =
        DistributionViewerCertificateArgs(AcmCertificateArn = io (cert.Apply(fun cert -> cert.Arn)), SslSupportMethod = "sni-only")

    let forwardeValueCookies =
        DistributionDefaultCacheBehaviorForwardedValuesCookiesArgs(Forward = "none")
    
    let forwardedValuesArgs =
        DistributionDefaultCacheBehaviorForwardedValuesArgs(
            QueryString = true,
            Cookies = forwardeValueCookies
        )

    let defaultCacheBehaviorArgs =
        DistributionDefaultCacheBehaviorArgs(
            AllowedMethods =
                inputList [ input "GET"
                            input "HEAD"
                            input "OPTIONS" ],
            CachedMethods = inputList [ input "GET"; input "HEAD" ],
            TargetOriginId = "myS3Origin",
            ForwardedValues = forwardedValuesArgs,
            ViewerProtocolPolicy = "redirect-to-https",
            MinTtl = 100,
            DefaultTtl = 3600,
            MaxTtl = 86400,
            SmoothStreaming = false,
            Compress = true
        )

    let geoRestrictions =
        DistributionRestrictionsGeoRestrictionArgs(RestrictionType = "none")

    let restrictionArgs =
        DistributionRestrictionsArgs(GeoRestriction = geoRestrictions)

    let cloudFrontDistributionArgs =
        DistributionArgs(
            Origins = originArgs,
            Enabled = true,
            Aliases = inputList [input s3AliasHost],
            Comment = "Distribution as S3 alias for Mastodon content delivery",
            DefaultRootObject = "index.html",
            PriceClass = "PriceClass_100",
            ViewerCertificate = viewerCertificate,
            DefaultCacheBehavior = defaultCacheBehaviorArgs,
            Restrictions = restrictionArgs
        )

    Distribution(prefixMastodonResource "media-distribution", cloudFrontDistributionArgs)
```

### Configuration and secrets

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

Just invoke `pulumi up`, wait for the deployment to finish and voi la you have your own Mastodon instance running on AWS: 

[^1]: There are 3 subnets in the default VPC for the `eu-central-1` region. One public subnet in each availability zone. I tried to get the number of subnets out of the Output of the `GetSubnets` Invoke but I did not find a way to do it. So I just hardcoded the number of subnets to 3.

[1]: https://github.com/simonschoof/mastodon-aws/tree/main/infrastructure/aws-services
[2]: https://docs.joinmastodon.org/user/run-your-own/#so-you-want-to-run-your-own-mastodon-server
[3]: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html
[4]: https://gist.github.com/ftpmorph/299c00907c827fbca883eeb45e6a7dc4?permalink_comment_id=4374053#gistcomment-4374053

