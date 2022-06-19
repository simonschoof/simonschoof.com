+++
author = "Simon Schoof"
title = "Pulumi, CloudFront & Lambda@Edge: Infrastructure"
date = "2022-06-02"
description = "Setup AWS CloudFront and AWS Lambda@Edge with Pulumi"
tags = [
    "infrastructure as code", 
    "pulumi",
    "aws",
    "fsharp"
]
series = "CloudFront and Lambda@Edge with Pulumi"
draft = true
+++
This post is part of a small article series about facilitating CloudFront and Lambda@Edge with Pulumi for on-the-fly image resizing.  
{{< series "CloudFront and Lambda@Edge with Pulumi" >}}  

In this part we will define the necessary AWS infrastructure using [Pulumi with F#](https://www.pulumi.com/docs/intro/languages/dotnet/). How to [setup Pulumi](https://www.pulumi.com/docs/get-started/) ist not part of this article. Nor is the explanation of [Pulumis architecture and concepts](https://www.pulumi.com/docs/intro/concepts/). One important concept of Pulumi are [inputs and outputs of resources](https://www.pulumi.com/docs/intro/concepts/inputs-outputs/). It is crucial to get an understanding of this concept to be able to define infrastructure with Pulumi. Unfortuanetly F#s type system is more rigid than the one of C# and needs explicit type conversions for the input and output types of Pulumi. To achieve this in a more F# idiomatic manner and ease there exists [helper functions](https://github.com/pulumi/pulumi/blob/master/sdk/dotnet/Pulumi.FSharp/Library.fs), [libraries](https://github.com/UnoSD/Pulumi.FSharp.Extensions) and [discussions](https://github.com/pulumi/pulumi/issues/3644) how to get to a more user friendly experience with Pulumi and F#.                
Basically we will use the default Pulumi configuration for a single developer and also use the [Pulumi Service as a backend](https://www.pulumi.com/docs/intro/concepts/state/) to store the state of the infrastructure. 



### Infrastructure 

##### S3

First we define the origin bucket. We will set the bucket private and restrict access to the S3 bucket.
This is just a simple restriction on the bucket. In a production environment you probably want to add additional layers of security like: 
  
  * SSL only connections
  * Disableb public object access
  * Using signed URLs or cookies
  * Geo restrictions
  * A *Web Application Firewall*  to prevent [*Denial of Wallet* attacks](https://medium.com/geekculture/denial-of-wallet-attack-3d8ecadfbd4e)

We also set a constant bucket name as we want to reference the bucket in our Lambda@Edge functions.

```fsharp
 let bucket =

        let asyncCallerIndentity =
            async {
                let! result = GetCallerIdentity.InvokeAsync() |> Async.AwaitTask
                return result
            }

        let asyncRegion =
            async {
                let! result = GetRegion.InvokeAsync() |> Async.AwaitTask
                return result
            }

        let callerIdentity =
            Async.RunSynchronously(asyncCallerIndentity)

        let region = Async.RunSynchronously(asyncRegion)

        let accountId = callerIdentity.AccountId

        let bucketName =
            "images-76b39297-2c72-426d-8c2e-98dc34bfcbe9-eu-central-1"

        let bucketArgs =
            BucketArgs(Acl = "private", BucketName = bucketName)

        Bucket(bucketName, bucketArgs)
```

##### IAM

In the next step we define our IAM policies so that CloudFront and the lambda functions can access the bucket
Therefore we create an [*Origin Access Identity*](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), a Lambda role, Lambda and CloudFront principals and eventually a bucket policy. 

```fsharp
    let originAccessIdentity =

        let originAccessIdentityArgs =
            OriginAccessIdentityArgs(Comment = "Access identy to access the origin bucket")

        OriginAccessIdentity("Cloudfront Origin Access Identity", originAccessIdentityArgs)

    let lambdaRole =

        let assumeRolePolicyJson =
            JsonSerializer.Serialize(
                Map<string, obj>
                    [ ("Version", "2012-10-17")
                      ("Statement",
                       Map<string, obj>
                           [ ("Action", "sts:AssumeRole")
                             ("Effect", "Allow")
                             ("Sid", "")
                             ("Principal",
                              Map [ ("Service",
                                     [ "lambda.amazonaws.com"
                                       "edgelambda.amazonaws.com" ]) ]) ]) ]
            )


        Role(
            "lambdaRole",
            RoleArgs(
                AssumeRolePolicy = assumeRolePolicyJson,
                Path = "/service-role/",
                ManagedPolicyArns = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
            )
        )

    let lambdaPrincipal =
        GetPolicyDocumentStatementPrincipalInputArgs(Type = "AWS", Identifiers = inputList [ io lambdaRole.Arn ])

    let cloudFrontPrincipal =
        GetPolicyDocumentStatementPrincipalInputArgs(
            Type = "AWS",
            Identifiers = inputList [ io originAccessIdentity.IamArn ]
        )

    let imageBucketPolicy =

        let getObjectStatement =
            GetPolicyDocumentStatementInputArgs(
                Principals =
                    inputList [ input lambdaPrincipal
                                input cloudFrontPrincipal ],
                Actions = inputList [ input "s3:GetObject" ],
                Resources =
                    inputList [ io bucket.Arn
                                io (Output.Format($"{bucket.Arn}/*")) ]
            )

        let putObjectAndListBucketStatement =
            GetPolicyDocumentStatementInputArgs(
                Principals = inputList [ input lambdaPrincipal ],
                Actions =
                    inputList [ input "s3:PutObject"
                                input "s3:ListBucket" ],
                Resources =
                    inputList [ io bucket.Arn
                                io (Output.Format($"{bucket.Arn}/*")) ]
            )


        let policyDocumentInvokeArgs =
            GetPolicyDocumentInvokeArgs(
                Statements =
                    inputList [ input getObjectStatement
                                input putObjectAndListBucketStatement ]
            )

        let policyDocument =
            GetPolicyDocument.Invoke(policyDocumentInvokeArgs)

        let bucketPolicyArgs =
            BucketPolicyArgs(Bucket = bucket.Id, Policy = io (policyDocument.Apply(fun (pd) -> pd.Json)))

        BucketPolicy("imageBucketpolicy", bucketPolicyArgs)
```

##### Lambda

Lambda functions for viewer request and origin response
Lambda functions with inlined code which just forwards and returns the viewer request and the origin response defined as a StringAsset.
Also a custom resource option because for Lambda@Edge the origin function has to be located in us-east-1.

```fsharp
 let lambdaOptions =
        let customResourceOptions = CustomResourceOptions()
        customResourceOptions.Provider <- Provider("useast1", ProviderArgs(Region = "us-east-1"))
        customResourceOptions

    let viewerRequestLambda =

        let lambdaFunctionArgs =
            Lambda.FunctionArgs(
                Handler = "index.handler",
                Runtime = "nodejs14.x",
                MemorySize = 128,
                Timeout = 1,
                Role = lambdaRole.Arn,
                Publish = true,
                Code =
                    input (
                        AssetArchive(
                            Map<string, AssetOrArchive>
                                [ ("index.js",
                                   StringAsset(
                                       """
                                       "use strict"; Object.defineProperty(exports, "__esModule", { value: true });
                                       exports.handler = void 0;
                                       async function handler(event) {
                                            return event.Records[0].cf.request;
                                       } 
                                       exports.handler = handler;
                                       """
                                   )) ]
                        )
                    )
            )

        Lambda.Function("viewerRequestLambda", lambdaFunctionArgs, lambdaOptions)

    let originResponseLambda =

        let lambdaFunctionArgs =
            Lambda.FunctionArgs(
                Handler = "index.handler",
                Runtime = "nodejs14.x",
                MemorySize = 512,
                Timeout = 5,
                Role = lambdaRole.Arn,
                Publish = true,
                Code =
                    input (
                        AssetArchive(
                            Map<string, AssetOrArchive>
                                [ ("index.js",
                                   StringAsset(
                                       """
                                       "use strict"; Object.defineProperty(exports, "__esModule", { value: true });
                                       exports.handler = void 0;
                                       async function handler(event) {
                                            return event.Records[0].cf.response;
                                       } 
                                       exports.handler = handler;
                                       """
                                   )) ]
                        )
                    )
            )

        Lambda.Function("originResponseLambda", lambdaFunctionArgs, lambdaOptions)
```

##### CloudFront
Finally the distribution

```fsharp
let cloudFrontDistribution =



        let s3OriginConfigArgs =
            DistributionOriginS3OriginConfigArgs(
                OriginAccessIdentity = originAccessIdentity.CloudfrontAccessIdentityPath
            )


        let originArgs =
            DistributionOriginArgs(
                DomainName = bucket.BucketRegionalDomainName,
                OriginId = "myS3Origin",
                S3OriginConfig = s3OriginConfigArgs
            )

        let viewerCertificate =
            DistributionViewerCertificateArgs(CloudfrontDefaultCertificate = true)

        let forwardeValueCookies =
            DistributionDefaultCacheBehaviorForwardedValuesCookiesArgs(Forward = "none")

        let forwardedValuesArgs =
            DistributionDefaultCacheBehaviorForwardedValuesArgs(
                QueryString = true,
                QueryStringCacheKeys =
                    inputList [ input "width"
                                input "height" ],
                Cookies = forwardeValueCookies
            )

        let lambdaViewerRequestAssociation =
            DistributionDefaultCacheBehaviorLambdaFunctionAssociationArgs(
                EventType = "viewer-request",
                LambdaArn = Output.Format($"{viewerRequestLambda.Arn}:{viewerRequestLambda.Version}"),
                IncludeBody = false
            )

        let lambdaOriginResponseAssociation =
            DistributionDefaultCacheBehaviorLambdaFunctionAssociationArgs(
                EventType = "origin-response",
                LambdaArn = Output.Format($"{originResponseLambda.Arn}:{originResponseLambda.Version}"),
                IncludeBody = false
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
                Compress = true,
                LambdaFunctionAssociations =
                    inputList [ input lambdaViewerRequestAssociation
                                input lambdaOriginResponseAssociation ]
            )

        let geoRestrictions =
            DistributionRestrictionsGeoRestrictionArgs(RestrictionType = "none")

        let restrictionArgs =
            DistributionRestrictionsArgs(GeoRestriction = geoRestrictions)

        let cloudFrontDistributionArgs =
            DistributionArgs(
                Origins = originArgs,
                Enabled = true,
                Comment = "Distribution for content delivery",
                DefaultRootObject = "index.html",
                PriceClass = "PriceClass_100",
                ViewerCertificate = viewerCertificate,
                DefaultCacheBehavior = defaultCacheBehaviorArgs,
                Restrictions = restrictionArgs
            )

        Distribution("imageResizerDistribution", cloudFrontDistributionArgs)
```
##### Outputs

```fsharp
    dict [ ("BucketName", bucket.Id :> obj)
           ("Distribution", cloudFrontDistribution.Id :> obj)
           ("LambdaRole", lambdaRole.Arn :> obj)
           ("OriginAccessIdentity", originAccessIdentity.IamArn :> obj)
           ("ViewerRequestLambda", viewerRequestLambda.Arn :> obj)
           ("OriginResponseLambda", originResponseLambda.Arn :> obj)
           ("ImageBucketPolicy", imageBucketPolicy.Id :> obj) ]
``` 
