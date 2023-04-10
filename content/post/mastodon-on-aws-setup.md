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
The code for this part can be found [here](https://github.com/simonschoof/mastodon-aws/tree/main/infrastructure/aws-services).
In this second part we will cover the steps to run Mastodon on AWS using ECS and Fargate.

{{< series "Running Mastodon on AWS" >}} 

### Introduction 

As we sucessfully got Mastdon to run locally in the previous part of this series, we can now get to setting up Mastodon to run on AWS. In the previous part we wanted to play around and get familiar with Mastodon we now want to run Mastodon in production on AWS. For this we want to leverage ESC with Fargate to run Mastodon. As we have also seen in the previous post an can also find in the [Run your own server section of the Mastodon documentation](https://docs.joinmastodon.org/user/run-your-own/#so-you-want-to-run-your-own-mastodon-server) we need more than just the compute part of AWS to get Mastodon up and running. We will take the parts from the run-your-own server documentation and will list them here again together with the AWS services which will provide the required 

{{<table tableWidth="95%">}}
Component | Service 
--------|------
Domain name | social.simonschoof.com: Not hosted on AWS, just using a subdomain on my already existing domain registrar  
Configuration and Secrets | AWS Parameter store and AWS Secretsmanager
Database | Amazon Aurora Serverless V2
Redis | Elasticache for Redis 
Load Balancer | ALB
VPN | AWS VPN
Container Orchestration | ECS and Fargate
E-mail provider | AWS SES
Object storage provider | AWS S3 
CDN | AWS CloudFront
{{</table>}}

* Also use Docker to run Mastodon not using EC2 instances
* Use Pulumi with F# to setup infrastructure and deploy Mastodon
* Describe the Cloud architecture -> Draw image here
* Go through the the einzelnen parts displayed in the table above
* Decribe the manual steps for the parts where some where necessary

### Architecture and provisioning with Pulumi

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

### Domain name certificates

###### Manual steps

### VPN and Security Groups
### ESC with Fargate

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

### SES

##### Manual steps

### S3 and CloudFront

##### Manual steps

### Cofiguration and Secrets

### Deploymenent and Maintenance
