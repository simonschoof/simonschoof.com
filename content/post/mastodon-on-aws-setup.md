+++
author = "Simon Schoof"
title = "Mastodon on AWS: Running on AWS"
date = "2023-06-01"
description = "Running Mastodon on AWS using Pulumi"
tags = [
    "mastodon",
    "infrastructure as code", 
    "pulumi",
    "aws",
    "fsharp"
]
series = "Running Mastodon on AWS"
draft = false
+++
This post is the second part of a series of two articles on deploying and running a [Mastodon][mastodondocs] instance on [AWS][aws]. The code for this part can be found [here][githubcode]. In this second part we will cover the steps to run Mastodon on AWS with ECS and Fargate.

{{< series "Running Mastodon on AWS" >}} 

### Introduction 

Having successfully got Mastodon running locally in the {{< prev-in-section "previous part" >}} of this series, we can now set Mastodon up to run on AWS. To set up Mastodon on AWS, we will use [Pulumi][pulumi] with F# to provision the AWS infrastructure and deploy the Mastodon application. Pulumi is my preferred tool for infrastructure as code. I have been using it for a while now as you can see in all of my blog posts in the [infrastructure as code][iac] category. 

For the previous part, the goal was to try out Mastodon and get familiar with it so that it would be easier to set up on AWS. To run Mastodon on AWS, I decided to use [AWS ECS][awsecs] with [AWS Fargate][awsfargate]. As we saw in the previous post and can also read in the [*Run your own server*][mastodonrunownserver] section of the Mastodon documentation, we need more than just the compute part of AWS to get Mastodon running. In the table below, I have listed the required parts from the *Run your own server* documentation again and noted next to them the providers we will use to provide the functionality. Later we will go into more detail about what we need to do for each part of the AWS infrastructure.

{{<table tableWidth="95%">}}
Component | Solution
--------|------
A domain name | [social.simonschoof.com](https://social.simonschoof.com): Not hosted on AWS, just a subdomain on my existing domain registrar. 
A VPS | We will use ECS and Fargate to run Mastodon, Aurora Serverless V2 for the database and Elasticache for Redis.
An email provider. | We will use AWS SES.
Optional: Object storage provider | We will use AWS S3 and CloudFront for the files uploaded by the users.
{{</table>}}

In the following sections I will give a brief overview of the architecture and the different parts of the AWS infrastructure. We will then go into more detail on how the different parts are set up.

### Architecture

The general architecture in AWS to run Mastodon looks like this:
 
{{<figure2 src="/images/aws_architecture.drawio.svg" class="mastodon-aws-architecture" caption="AWS Architecture for Mastodon" >}}

The general idea was to make the architecture as "simple" as possible.
This means that we will use the default [VPC][awsvpc], which is public by default, and the default [subnets][awssubnets] provided by AWS. For a more critical application, for example, I would put the database, ECS service and other components on a private subnet as [recommended by AWS][awsnetworksec]. Without a private subnet, we can secure the services using [security groups][awssecgroups], which we will do.

As shown in the architecture diagram, we will use the following AWS services:

* [AWS VPC][awsvpc] for the VPC
* [AWS Application Load Balancer(ALB)][awsalb] for the load balancer
* [AWS Aurora Serverless V2][awsaurorav2] with a [PostgreSQL][postgresql] engine for the database
* [AWS Elasticache for Redis][awselasticacheredis] for [Redis][redis]
* [AWS ECS][awsecs] and  [AWS Fargate][awsfargate] for the container orchestration
* [AWS SES][awsses] for the e-mail provider
* [AWS S3][awss3] for the object storage provider
* [AWS CloudFront][awscloudfront] for the CDN
* [AWS Systems Manager Parameter Store][awsssm] for configuration
* [AWS Secrets Manager][awssm] for secrets
* [AWS Certificate Manager][awscm] for certificates

As mentioned earlier, we will use the standard VPC and subnets provided by AWS. Within the VPC, we will provide an ALB to direct traffic to the [web container][mastodonweb], running a [Ruby on Rails][rubyonrails] backend with a [React.js][reactjs] frontend, and to the [streaming container][mastodonstreaming], a [Node.js][nodejs] application for the streaming API. Since the web container and the streaming container are accessed via different ports and paths, we will use two target groups for the ALB. One for the web container listening on port 3000 and the other for the streaming container listening on port 4000 and accessed via the path `/api/v1/streaming`. The tasks within the ECS service will be able to access the PostgreSQL and Redis databases, the S3 bucket and the SES service.

The ALB is secured by a security group that only allows traffic from the Internet via port 80 and 443. The http traffic on port 80 is redirected to https on port 443. The https traffic is secured by a certificate from AWS Certificate Manager. The certificate is requested for the domain name `social.simonschoof.com` of the Mastodon instance. The web and streaming containers running on ECS and Fargate are secured by a security group that only allows traffic from the ALB and to PostgreSQL, Redis, S3 and SES. The PostgreSQL and Redis databases are also protected by a security group that only allows traffic from the web and streaming containers running on ECS and Fargate.

In order for the Mastodon instance to send emails, we use AWS SES.
AWS SES is configured to use the domain name of the Mastodon instance as the sender domain. The sender domain must be verified in AWS SES. In addition, AWS SES is configured to use the SMTP interface to send emails. The SMTP credentials are stored in AWS Secrets Manager.

AWS S3 will be used to store the user uploaded media files. As I wanted to keep the bucket private, we will use a CloudFront distribution to serve the media files to the users. AWS CloudFront will be configured to use the subdomain `mastodonmedia.simonschoof.com` and only allow https traffic. The certificate for the subdomain is requested from the AWS Certificate Manager.

The configuration for the Mastodon instance is stored in the AWS Systems Manager Parameter Store. The secrets are stored in AWS Secrets Manager. The parameters and secrets are retrieved via Pulumi during the deployment of the Mastodon instance and set as environment variables in the ECS task definition.

After the general overview of the architecture, we will now go into more detail on how the different parts of the AWS infrastructure are set up.

### Domain name and certificates

As mentioned above, we will use the AWS Certificate Manager to request the certificates for the instance domain name `social.simonschoof.com` and the media file domain name `mastodonmedia.simonschoof.com`. Since I have already registered a domain name with a domain registrar, I will not use [AWS Route 53][awsroute53] to register the domain name. Instead, I will use the DNS validation method to validate the domain names. For this purpose, I created a CNAME record in my domain registrar's DNS configuration that points to the DNS name provided by the AWS Certificate Manager. For the media file domain used as the alternate domain name for the CloudFront distribution, the certificate is requested in the region `us-east-1`, which is a [requirement for CloudFront][awscloudfrontrequirements]. For the instance's domain name, the certificate is requested in the region `eu-central-1`, which is the region I use for all other resources. All the steps to request the certificates and the DNS validation were done manually by me in the AWS console and at my domain registrar and are not part of the Pulumi code.

### SES

Another part of the application where I did not use Pulumi was setting up the AWS SES service. Setting up AWS SES is quite simple and is described in the [AWS SES documentation][awssessetup]. The SMTP credentials can be created manually in the AWS SES console. The SMTP credentials are stored in the AWS Secrets Manager, from where they are retrieved during the deployment of the Mastodon instance, as we will see later in the [configuration-and-secrets](#configuration-and-secrets) section. The SES credentials to be created are unique per region. When you start with AWS SES, you are in the sandbox mode. In the sandbox mode, you can only send emails to verified email addresses. To send email to non-verified email addresses, you must request production access. This is also described in the [AWS SES documentation][awssesrequestprodaccess]. For setting up a single user instance configuration, it is not necessary to request production access because the only email the instance will write to is the email of my admin user account. So I only checked the email address of my admin user account and did not request production access.

### VPC and security groups

To run Mastodon in AWS, we need a network infrastructure to run the various services. As mentioned earlier, we will use the default VPC and subnets provided by AWS. To secure the services within the VPC, we will use security groups for the different services. For a Mastodon instance with one user, this setup seems to be sufficient. For an instance with multiple users, you should use a private subnet for the database and Redis, as recommended by AWS. The VPC and security groups are created via Pulumi. The default VPC and subnets should be in place and automatically created by AWS when you create an AWS account.

If you define the [default VPC][pulumidefaultvpc] and [default subnets][pulumidefaultsubnets] in Pulumi, both will be added to the Pulumi stack but will not be managed by Pulumi. This means that removing the default VPC and subnets from the Pulumi stack does not remove them from AWS unless explicitly specified. To add the default VPC and subnets to the Pulumi stack, we just need to write the following code<cite>[^1]<cite>:

     
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

Then we can define the security groups for the different services. There will be a security group for: 

* the PostgreSQL database<cite>[^2]<cite>
* the Redis database
* the ECS Fargate service 
* the ALB


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

After we have defined the security groups, we can add rules to these groups. We can add rules for incoming and outgoing traffic. First we define the rules for incoming traffic as follows:

* The RDS security group allows incoming traffic from the ECS security group on port 5432.
* The Elasticache security group allows incoming traffic from the ECS security group on port 6379.
* The ECS security group allows inbound traffic from the load balancer security group on port 3000 and 4000 for the Mastodon web and streaming service.
* The load balancer security group allows incoming traffic from the Internet on port 80 and 443 for the Mastodon web service. The incoming traffic on port 80 is redirected to port 443, as we will see later in the [Load Balancer section](#alb).

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

After we have defined the rules for incoming traffic, we can define the rules for outgoing traffic as follows:

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

For the PostgreSQL database I decided to try the AWS Aurora serverless v2 version which is, according to AWS, [a good fit for development and testing environments][awsaurorav2userguide] because we can  define a low minimum capacity for the database. Defining the PostgreSQL database is straigthforward and it is defined as follows:

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

To use the Aurora serverless v2 version we need to define the `EngineMode` as `provisioned` and provide the `Serverlessv2ScalingConfiguration` argument. I also set the deletion protection to `true` to prevent the database from being deleted by accident. Furthermore, I set the `SkipFinalSnapshot` argument to `false` and provide a `FinalSnapshotIdentifier` to create a final snapshot of the database when it is deleted. The last thing to point out is that I set the `ApplyImmediately` argument to `true` to apply changes immediately and not wait for the next maintenance window.


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

The next step is to define the Application Load Balancer (ALB), the Elastic Container Service (ECS) and the Fargate tasks. This is, next to the S3 bucket and the CloudFront distribution, the most complex part of the deployment. We will go through the different parts step by step, starting with the ALB. For the Pulumi code in this section, we use both the [classic AWS package][pulumiawsclassic] `Pulumi.Aws` and the [AWS crosswalk package][pulumiawscrosswalk] `Pulumi.Awsx`. When using the crosswalk package, we use the qualified name `Awsx` to avoid name conflicts with the classic AWS package.

##### ALB

Before we can start defining the ALB, we need to obtain the certificate for the Mastodon instance domain:

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

With the certificate in hand, we can start defining the ALB itself:

```fsharp
let loadBalancerArgs = LoadBalancerArgs(
    IpAddressType = "ipv4",
    LoadBalancerType = "application",
    SecurityGroups = inputList [ io loadBalancerSecurityGroup.Id],
    Subnets = inputList (defaultSubnetIds |> List.map io)

let loadBalancer = LoadBalancer(prefixMastodonResource "load-balancer", loadBalancerArgs)
```

In addition to the load balancer itself, we define two [target groups][awstargetgroups]. Target groups are used to forward requests to the different services running in the ECS cluster. In our case, we define a target group for the Mastodon web application listening on port `3000` and a target group for the Mastodon streaming application listening on port `4000` and the path `/api/v1/streaming/health`. The target groups are defined as follows

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

As mentioned earlier, the http requests on port 80 are redirected to port 443. To map this in AWS with Pulumi, we define an http listener as follows:

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

In the listener args we connect the listener to the load balancer and define the default action to redirect the requests to port 443. To handle the https requests, we define an https listener connected to the load balancer and the certificate we obtained at the beginning of this section:

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

The streaming application is accessible via port 4000 and the path `/api/v1/streaming`. To get the correct routing, we need to define a rule for the streaming target group:

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

Once the ALB is set up, we can start defining the [ESC task][awsecstaskdefinitions] and the [container definitions][awsecscontainerdefinitions] that will be launched as part of the task. In our case, we define a task with four containers, one for the Mastodon web application, one for the Mastodon streaming application, one for the Mastodon Sidekiq application, and an optional container definition for a PostgreSQL container for maintenance and debugging purposes<cite>[^3]<cite>.

All container definitions are stored in a list that is later made available to the Fargate service:

```fsharp
let containerDefinitionsList =
    System.Collections.Generic.Dictionary<string, Awsx.Ecs.Inputs.TaskDefinitionContainerDefinitionArgs>()
```

We start with the PostgreSQL container definition. The PostgreSQL container definition is optional and can be used for maintenance and debugging purposes. The PostgreSQL task definition is started only when the `RunMode` is set to `Debug` or `Maintenance`:

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

The PostgreSQL container is based on the `postgres:latest` image and runs a bash script that sleeps for 3600 seconds. This is done to keep the container running. The PostgreSQL container is not essential and will not be restarted if it fails. This is done to prevent the PostgreSQL container from restarting when the database is unavailable.

Next, we define the Mastodon web application container. For the web application, we define a container port mapping for port 3000, where we map the port to the web target group defined earlier. We also define a container command that starts the Mastodon web application. The container command is different depending on the `runMode`. For `Maintenance` and `Debug`, we start a bash script that sleeps for 3600 seconds so we can connect to the container and debug the application. For `Production` we start the Mastodon web application. The container is configured using environment variables that are required for Mastodon. How these environment variables are defined is explained in the section [Configuration and secrets](#configuration-and-secrets):

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

In analogy to the web application container, we define the Mastodon Streaming Application Container. Again, we define a port mapping that maps port 4000 to the streaming target. The container command launches the Mastodon streaming application as a Node.js application. The container is also configured with the environment variables that are required for Mastodon:

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

The last container we define is the Mastodon [Sidekiq][rubysidekiq] container. The Sidekiq framework is used for background job processing in combination with Ruby on Rails applications. The Sidekiq application is also configured with the environment variables that are required for Mastodon. For the Sidekiq container we don't define a port mapping as the Sidekiq container is not reachable from the outside and only communicates with the Mastodon web application over the internal network of the Fargate service:

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

After completing the container task definition, we can start defining the ECS cluster using Fargate as the compute engine.

First we define the ECS cluster to logically group the containers running in the ECS cluster. Here we also set the capacity provider to `FARGATE_SPOT`, hoping that this will save us some money<cite>[^4]:

```fsharp
let clusterArgs = ClusterArgs(
    CapacityProviders = inputList [input "FARGATE_SPOT"]
)

let cluster =
    Cluster(prefixMastodonResource "ecs-cluster", clusterArgs)
```

In the second step, we prepare a task role that allows us to connect to the containers in the ECS cluster. For this, we need an assume role policy and a task policy that enables communication between the containers and the managed SSM agent. This is required to connect to the containers via AWS ECS Exec. The task role is defined as follows:

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

The third step includes the Fargate service definition that uses the task definitions and ECS cluster that we defined in the previous steps using the simplified Fargate service definition from the `Awsx` package. We also see that we add the task role with the policy to the Fargate service definition only when the `RunMode` is set to `Maintenance` or `Debug`. We also define the network configuration for the Fargate service. Here we set the `AssignPublicIp` property to `true` so that the containers can be accessed from outside. To prevent the containers from being reachable from the outside, we set the ECS security group that we defined earlier in the section about the [VPC and security groups](#vpc-and-security-groups). Another property that is only set when `runMode` is set to `Maintenance` or `Debug` is the `EnableExecuteCommand` property, which is also needed to connect to the containers in the ECS cluster via the AWS Systems Manager Session Manager:

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

An optional element, as described in the Mastodon documentation, is an object storage provider. Since we will be running Mastodon in Docker containers, we will need to use an external object storage provider, for which we will use AWS S3. In addition to the bucket itself, we will also create a CloudFront distribution to serve user-uploaded files from the S3 bucket. With the CloudFront distribution, we can also use a custom domain name to serve the files uploaded by the user. With the custom domain, we also don't have to worry about breaking the links to the user uploaded files if we change the object storage provider. Another advantage of using CloudFront is that we don't have to make the S3 bucket publicly available because we can restrict access to the S3 bucket to the CloudFront distribution.

##### S3 bucket

In order for Mastodon to access the S3 bucket, we need to give Mastodon an AWS access key ID and an AWS access key ID secret. Since it's not entirely clear from the Mastodon documentation what permissions Mastodon needs to access the S3 bucket, I followed Daniel Snider's approach, which he describes in [this GitHub gist][githubmastodons3permission]. I also manually configured part of it in the AWS console. The parts I manually configured in the AWS console are creating the user `mastodon-s3-user` and adding that user to the `mastodon-s3-access-group` that we will create in the Pulumi deployment. I also created the access key and secret key for the `mastodon-s3-user` user and stored it in the AWS Secrets Manager.

First, we create the bucket and block public access to it:

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

After that, we can create the S3 access group, a policy document, a policy and the policy attachment for this group:

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

Now we can add the user `mastodon-s3-user` to the group `mastodon-s3-access-group` that we created above. This step is also done manually in the AWS console. From here, we just need to tell Mastodon the access key ID and the secret access key ID and we can store the files uploaded by the user in the S3 bucket.

##### CloudFront distribution

For the CloudFront distribution, we first define the origin access identity and a bucket policy for the S3 bucket so that we allow CloudFront to retrieve objects from the S3 bucket:

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

To support HTTPS, we also need to retrieve the certificate for the S3 alias host domain that we created using AWS Certificate Manager. For CloudFront, this certificate must be stored in the us-east-1 region:

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

Finally, we can create the CloudFront distribution with the certificate, the S3 alias host domain, and the S3 bucket as the origin:

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

In the previous section, we created a lot of resources that need to be configured in the Mastodon configuration. I created the namespace `MastodonAwsServices.Configuration` which contains the following modules:

* Secrets -> provides a function to retrieve secrets from the AWS Secrets Manager.
* Configuration -> provides a function to retrieve configuration values from the AWS Systems Manager Parameter Store
* Values -> provides all configuration values for the Mastodon instance and AWS resources.

The Secrets and Configuration modules are very similar. They both provide a function that retrieves a value from AWS. The only difference is that the Secrets module retrieves the value from the AWS Secrets Manager and the Configuration module retrieves the value from the AWS Systems Manager Parameter Store.

```fsharp
module Secrets =
    open Amazon.SecretsManager
    open Amazon.SecretsManager.Model
    open System.Threading


    let getSecret (secretName: string) =
        let awsSecretManagerClient = new AmazonSecretsManagerClient()
        let mutable secretValueRequest = GetSecretValueRequest()
        secretValueRequest.SecretId <- secretName


        let asyncSecret =
            async {
                let! result =
                    awsSecretManagerClient.GetSecretValueAsync(secretValueRequest, CancellationToken(false))
                    |> Async.AwaitTask

                return result
            }

        let secretResponse = Async.RunSynchronously(asyncSecret)
        secretResponse.SecretString

module Params =
    open Amazon.SimpleSystemsManagement
    open Amazon.SimpleSystemsManagement.Model
    open System.Threading

    let getParameter (parameterName: string) =
        let client = new AmazonSimpleSystemsManagementClient()
        let mutable parameterRequest = GetParameterRequest()
        parameterRequest.Name <- parameterName

        let asyncParameter =
            async {
                let! result =
                    client.GetParameterAsync(parameterRequest, CancellationToken(false))
                    |> Async.AwaitTask

                return result
            }

        let parameterResponse = Async.RunSynchronously(asyncParameter)
        parameterResponse.Parameter.Value
```

The Values module contains all the configuration values for the Mastodon instance and AWS resources. The values are retrieved from AWS Secrets Manager and AWS Systems Manager Parameter Store.

```fsharp
module Values = 
    open Secrets
    open Params
    open Pulumi
    open Pulumi.Awsx.Ecs.Inputs
    open Pulumi.FSharp

    type RunMode =
        | Production
        | Maintenance
        | Debug 

    let runMode = Production
    let awsConfig = Config("aws");
    let mastodonImage = "tootsuite/mastodon:v4.1.2"
    // Pulumi
    let mastodonResourcePrefix = "mastodon-"
    let prefixMastodonResource resourceNameToPrefix= mastodonResourcePrefix + resourceNameToPrefix  

    // RDS
    let rdsDbMasterPassword= getSecret"mastodon/rds/db-master-password"

    // Mastodon federatiom
    let localDomain = "social.simonschoof.com"
    let singleUserMode = "true"
    let defaultLocale="en"
    let alternateDomains = "" 

    // Mastodon secrets
    let secretKeyBase= getSecret "mastodon/secrets/secret-key-base"
    let otpSecret = getSecret "mastodon/secrets/otp-secret"
    let vapIdPrivateKey = getSecret "mastodon/secrets/vapid-private-key"
    let vapIdPublicKey = getSecret "mastodon/secrets/vapid-public-key"

    // Mastodon deployment
    let railsEnv = "production"
    let railsServeStaticFiles = "true"
    let railsLogLevel = "warn"
    let nodeEnv = "production"

    // Mastodon postgres
    let dbHost = getParameter "/mastodon/postgres/db-host"
    let dbUser = getParameter "/mastodon/postgres/db-user"
    let dbName = getParameter "/mastodon/postgres/db-name"
    let dbPass = getSecret "mastodon/postgres/db-pass"
    
    // Mastodon redis
    let redisHost = getParameter "/mastodon/redis/redis-host"

    // Mastodon email
    let stmpServer = getParameter "/mastodon/mail/smtp-server"
    let smtpPort = getParameter "/mastodon/mail/smtp-port"
    let smtpLogin = getParameter "/mastodon/mail/smtp-login"
    let smtpPassword = getSecret "mastodon/mail/smtp-password"
    let smtpFromAddress = getParameter "/mastodon/mail/smtp-from-address"
    let smtpDomain= "social.simonschoof.com"
    let smtpAuthMethod = "plain"
    let smtpOpenSslVerifyMode = "none"
    let smtpEnableStarttls = "auto" 

    // Mastodon Amazon S3 and compatible
    let s3AliasHost = "mastodonmedia.simonschoof.com"
    let s3Enabled= "true"
    let s3Bucket =  getParameter "/mastodon/s3/bucket"
    let awsAccessKeyId = getSecret "mastodon/s3/aws-access-key-id"
    let awsSecretAccessKey = getSecret "mastodon/s3/aws-secret-access-key"
    let s3Region = awsConfig.Require("region")
    let s3Protocol = "HTTPS"
    let s3Hostname = getParameter "/mastodon/s3/hostname"

    // Mastodon other
    let skipPostDeploymentMigrations = "true"
```

Finally, we need a list of `TaskDefinitionKeyValuePairArgs` that we can use to configure the Mastodon containers. For the secret values, we use [Pulumi's `Output.CreateSecret`][pulumisecrets] function so that the secret is not logged during deployment and masked in the Pulumi state file. By using the `Output.CreateSecret` function once in the definition of the list, the entire list will be classified as secret in the Pulumi state file.

```fsharp
let mastodonContainerEnvVariables  = inputList [
    input (TaskDefinitionKeyValuePairArgs(Name = "LOCAL_DOMAIN", Value = localDomain));
    input (TaskDefinitionKeyValuePairArgs(Name = "SINGLE_USER_MODE", Value = singleUserMode));
    input (TaskDefinitionKeyValuePairArgs(Name = "DEFAULT_LOCALE", Value = defaultLocale));
    io (Output.CreateSecret (TaskDefinitionKeyValuePairArgs(Name = "SECRET_KEY_BASE", Value = secretKeyBase)));
    io (Output.CreateSecret (TaskDefinitionKeyValuePairArgs(Name = "OTP_SECRET", Value = otpSecret)));
    io (Output.CreateSecret (TaskDefinitionKeyValuePairArgs(Name = "VAPID_PRIVATE_KEY", Value = vapIdPrivateKey)));
    io (Output.CreateSecret (TaskDefinitionKeyValuePairArgs(Name = "VAPID_PUBLIC_KEY", Value = vapIdPublicKey)));
    input (TaskDefinitionKeyValuePairArgs(Name = "RAILS_ENV", Value = railsEnv));
    input (TaskDefinitionKeyValuePairArgs(Name = "RAILS_SERVE_STATIC_FILES", Value = railsServeStaticFiles));
    input (TaskDefinitionKeyValuePairArgs(Name = "RAILS_LOG_LEVEL", Value = railsLogLevel));
    input (TaskDefinitionKeyValuePairArgs(Name = "NODE_ENV", Value = nodeEnv));
    input (TaskDefinitionKeyValuePairArgs(Name = "DB_HOST", Value = dbHost));
    input (TaskDefinitionKeyValuePairArgs(Name = "DB_USER", Value = dbUser));
    input (TaskDefinitionKeyValuePairArgs(Name = "DB_NAME", Value = dbName));
    io (Output.CreateSecret (TaskDefinitionKeyValuePairArgs(Name = "DB_PASS", Value = dbPass)));
    input (TaskDefinitionKeyValuePairArgs(Name = "REDIS_HOST", Value = redisHost));
    input (TaskDefinitionKeyValuePairArgs(Name = "SMTP_SERVER", Value = stmpServer));
    input (TaskDefinitionKeyValuePairArgs(Name = "SMTP_PORT", Value = smtpPort));
    input (TaskDefinitionKeyValuePairArgs(Name = "SMTP_LOGIN", Value = smtpLogin));
    io (Output.CreateSecret (TaskDefinitionKeyValuePairArgs(Name = "SMTP_PASSWORD", Value = smtpPassword)));
    input (TaskDefinitionKeyValuePairArgs(Name = "SMTP_FROM_ADDRESS", Value = smtpFromAddress));
    input (TaskDefinitionKeyValuePairArgs(Name = "SMTP_DOMAIN", Value = smtpDomain));
    input (TaskDefinitionKeyValuePairArgs(Name = "SMTP_AUTH_METHOD", Value = smtpAuthMethod));
    input (TaskDefinitionKeyValuePairArgs(Name = "SMTP_OPENSSL_VERIFY_MODE", Value = smtpOpenSslVerifyMode));
    input (TaskDefinitionKeyValuePairArgs(Name = "SMTP_ENABLE_STARTTLS", Value = smtpEnableStarttls));
    input (TaskDefinitionKeyValuePairArgs(Name = "S3_ALIAS_HOST", Value = s3AliasHost));
    input (TaskDefinitionKeyValuePairArgs(Name = "S3_ENABLED", Value = s3Enabled));
    input (TaskDefinitionKeyValuePairArgs(Name = "S3_BUCKET", Value = s3Bucket));
    io (Output.CreateSecret (TaskDefinitionKeyValuePairArgs(Name = "AWS_ACCESS_KEY_ID", Value = awsAccessKeyId)));
    io (Output.CreateSecret (TaskDefinitionKeyValuePairArgs(Name = "AWS_SECRET_ACCESS_KEY", Value = awsSecretAccessKey)));
    input (TaskDefinitionKeyValuePairArgs(Name = "S3_REGION", Value = s3Region));
    input (TaskDefinitionKeyValuePairArgs(Name = "S3_PROTOCOL", Value = s3Protocol));
    input (TaskDefinitionKeyValuePairArgs(Name = "S3_HOSTNAME", Value = s3Hostname));
    input (TaskDefinitionKeyValuePairArgs(Name = "S3_PERMISSION", Value = ""));
    input (TaskDefinitionKeyValuePairArgs(Name = "SKIP_POST_DEPLOYMENT_MIGRATIONS", Value = skipPostDeploymentMigrations))
]
```

### Spin up the Mastodon instance

Now that we have set up all the infrastructure code and manually prepared the [domain name and certificates](#domain-name-and-certificates), [SES](#ses) and the [access to the S3 bucket](#s3-bucket), we can deploy our own Mastodon instance. We just need to call `pulumi up`, wait for the deployment to complete and voi la we have our own Mastodon instance running on AWS. 

You can find my instance at [social.simonschoof.com](https://social.simonschoof.com). If you want to deploy your own instance, you can find the code for the infrastructure in the [aws-services][githubcode] folder.
 

[^1]: There are 3 subnets in the default VPC for the `eu-central-1` region. One public subnet in each availability zone. I tried to get the number of subnets out of the Output of the `GetSubnets` Invoke but I did not find a way to do it. So I just hardcoded the number of subnets to 3.

[^2]: The security group for the PostgreSQL database is called `rdsSecurityGroup` because we use the [RDS service][awsrds] from AWS with the Aurora Serverless v2 engine, which is compatible with PostgreSQL.

[^3]: To be able to test and debug the application, I added a configuration type with three states: ```type RunMode =
        | Production
        | Maintenance
        | Debug```. When the `RunMode` is set to `Maintenace` or `Debug`, an additional PostgreSQL container is created. From the PostgreSQL container the PostgreSQL database can be accessed. To get access to PostgreSQL and the other containers directly from my shell, I use [AWS ECS Exec][awsecsexec]. In order for AWS ECS Exec to work, I had to install the AWS CLI and the AWS Session Manager plugin on my machine. I also had to [add an IAM role](#container-task-definitions) to allow communication between the containers and the managed SSM agent. As a final step, I had to set the `ExecuteCommmand` flag in the [ESC service definition](#ecs-with-fargate). After that, you can execute commands on your containers using `aws ecs execute-command`. You can use the [AWS ECS Exec Checker][awsecsexecchecker] to check if everything is configured correctly to access the containers.

[^4]: While it does indeed save some money, it also reduces the availability of the service since I only run one instance of each container in the ECS task. 

[mastodondocs]: https://docs.joinmastodon.org/
[aws]: https://aws.amazon.com/
[awsecs]: https://aws.amazon.com/ecs/
[awsfargate]: https://aws.amazon.com/fargate/
[socialsimonschoof]: https://social.simonschoof.com
[awsnetworksec]: https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html
[awsvpc]: https://aws.amazon.com/vpc/
[awsalb]: https://aws.amazon.com/elasticloadbalancing/application-load-balancer/?nc=sn&loc=2&dn=2
[awsaurorav2]: https://aws.amazon.com/rds/aurora/serverless/
[awselasticacheredis]: https://aws.amazon.com/elasticache/redis/
[awsses]: https://aws.amazon.com/ses/
[awss3]: https://aws.amazon.com/s3/
[awscloudfront]: https://aws.amazon.com/cloudfront/
[awsssm]: https://aws.amazon.com/systems-manager/features/#Parameter_Store
[awssm]: https://aws.amazon.com/secrets-manager/
[awscm]: https://aws.amazon.com/certificate-manager/
[awssecgroups]: https://docs.aws.amazon.com/vpc/latest/userguide/security-groups.html
[awssubnets]: https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html
[awsroute53]: https://aws.amazon.com/route53/\
[awscloudfrontrequirements]: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html
[awssessetup]: https://docs.aws.amazon.com/ses/latest/DeveloperGuide/send-email-set-up.html
[awssesrequestprodaccess]: https://docs.aws.amazon.com/ses/latest/DeveloperGuide/request-production-access.html
[awsrds]: https://docs.aws.amazon.com/rds/index.html
[awstargetgroups]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html
[awsecstaskdefinitions]:https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html
[awsecscontainerdefinitions]: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html
[awsecsexec]: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html
[awsecsexecchecker]: https://github.com/aws-containers/amazon-ecs-exec-checker
[mastodonweb]: https://docs.joinmastodon.org/dev/overview/
[mastodonstreaming]: https://docs.joinmastodon.org/methods/streaming/
[rubyonrails]: https://rubyonrails.org/
[rubysidekiq]: https://sidekiq.org/
[reactjs]: https://reactjs.org/
[nodejs]: https://nodejs.org/en/
[postgresql]: https://www.postgresql.org/
[redis]: https://redis.io/
[pulumi]: https://www.pulumi.com/
[pulumidefaultvpc]: https://www.pulumi.com/registry/packages/aws/api-docs/ec2/defaultvpc/
[pulumidefaultsubnets]: https://www.pulumi.com/registry/packages/aws/api-docs/ec2/defaultsubnet/
[pulumiawsclassic]: https://www.pulumi.com/registry/packages/aws/
[pulumiawscrosswalk]: https://www.pulumi.com/docs/clouds/aws/guides/
[pulumisecrets]: https://www.pulumi.com/docs/concepts/secrets/
[iac]: {{< ref "/tags/infrastructure-as-code/" >}}
[githubcode]: https://github.com/simonschoof/mastodon-aws/tree/main/infrastructure/aws-services
[mastodonrunownserver]: https://docs.joinmastodon.org/user/run-your-own/#so-you-want-to-run-your-own-mastodon-server
[awsaurorav2userguide]: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html
[githubmastodons3permission]: https://gist.github.com/ftpmorph/299c00907c827fbca883eeb45e6a7dc4?permalink_comment_id=4374053#gistcomment-4374053
