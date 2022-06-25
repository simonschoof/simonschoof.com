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
This post is part of a small article series about facilitating CloudFront and Lambda@Edge with Pulumi for on-the-fly image resizing. The code for this part can be found [here](https://github.com/simonschoof/lambda-at-edge-example/tree/main/pulumi). 
{{< series "CloudFront and Lambda@Edge with Pulumi" >}}  

In this part we will define the necessary AWS infrastructure using [Pulumi with F#](https://www.pulumi.com/docs/intro/languages/dotnet/). How to [setup Pulumi](https://www.pulumi.com/docs/get-started/) ist not part of this article. Nor is the explanation of [Pulumis architecture and concepts](https://www.pulumi.com/docs/intro/concepts/). One important concept of Pulumi to mention is [inputs and outputs of resources](https://www.pulumi.com/docs/intro/concepts/inputs-outputs/). It is crucial to get an understanding of this concept to be able to define infrastructure with Pulumi. Unfortuanetly F#s type system is more rigid than the one of C# and needs explicit type conversions for the input and output types of Pulumi. To achieve this in a more F# idiomatic manner and ease there are existing [helper functions](https://github.com/pulumi/pulumi/blob/master/sdk/dotnet/Pulumi.FSharp/Library.fs), [libraries](https://github.com/UnoSD/Pulumi.FSharp.Extensions) and [discussions](https://github.com/pulumi/pulumi/issues/3644) how to get to a more idiomatic experience with Pulumi and F#.                
Regarding the setup of Pulumi for this small project we will use the default Pulumi configuration for a single developer and also use the [Pulumi Service as a backend](https://www.pulumi.com/docs/intro/concepts/state/) to store the state of the infrastructure. 



### Infrastructure 

##### S3

As we have seen in the previous article CloudFront needs an origin from where it can fetch the content before it can be stored in the regional cache. This can be a custom origin or a S3 bucket. We will just go with an S3 bucket as we want to define the infrastructure within AWS.
Therefore we define the origin bucket first. We will set the bucket private to restrict public access on the bucket.
This is just the obvious security restriction. In a production environment you probably want to add additional layers of security like: 
  
  * SSL only connections
  * Disableb public object access
  * Using signed URLs or cookies
  * Geo restrictions
  * A *Web Application Firewall*  to prevent [*Denial of Wallet* attacks](https://medium.com/geekculture/denial-of-wallet-attack-3d8ecadfbd4e)

We also set a constant bucket name as we want to reference the bucket in our Lambda@Edge functions.

```fsharp
let bucket =
    let bucketName =
        "images-76b39297-2c72-426d-8c2e-98dc34bfcbe9-eu-central-1"
    
    let bucketArgs =
        BucketArgs(Acl = "private", BucketName = bucketName)
    
    Bucket(bucketName, bucketArgs)
```

##### IAM

In the second step we define our IAM policies so that CloudFront and the AWS Lambda functions can access the origin AWS S3 Bucket.

Therefore we create the following resources:
1. [An Origin Access Identity](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html) -> This is a special CloudFront user we can use to access the private origin S3 Bucket.
2. [A AWS Lambda execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html) with permission to call the AWS Security Token Service AssumeRole action.
3. [Two Principals](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html) -> One for Lambda and one for CloudFront. 
4. [A AWS S3 Bucket policy](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-policy-language-overview.html) -> In the policy we grant the permissions for Lambda and CloudFront to access the origin AWS S3 Bucket. 


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

    let listBucketStatement =
        GetPolicyDocumentStatementInputArgs(
            Principals = inputList [ input lambdaPrincipal ],
            Actions =
                inputList [ input "s3:ListBucket" ],
            Resources =
                inputList [ io bucket.Arn
                            io (Output.Format($"{bucket.Arn}/*")) ]
        )

    let policyDocumentInvokeArgs =
        GetPolicyDocumentInvokeArgs(
            Statements =
                inputList [ input getObjectStatement
                            input listBucketStatement ]
        )

    let policyDocument =
        GetPolicyDocument.Invoke(policyDocumentInvokeArgs)

    let bucketPolicyArgs =
        BucketPolicyArgs(Bucket = bucket.Id, Policy = io (policyDocument.Apply(fun (pd) -> pd.Json)))
    BucketPolicy("imageBucketpolicy", bucketPolicyArgs)
```

##### Lambda

In the third step we define two Lambda functions for the origin response and viewer request trigger points. There are some points we want to emphasize for the definition of the Lambda functions: 

1. [US East](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-restrictions.html) -> The Lambda function has to be in the `us-east-1`region.
2. [Publish = true](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-how-it-works.html) ->  The `Publish` flag has to be set to true, so that a new version of the Lambda function will be published during the creation or an update of the Lambda  function. A lambda function can only be associated to CloudFront with a given version number.
3. [Code](https://www.pulumi.com/docs/intro/concepts/assets-archives/) -> We use an inlined Pulumi `StringAsset` for the `Code` parameter of the Lambda function definition. The inlined code fragments do nothing more than forwarding and returning the CloudFront viewer request and origin response. We will replace the code fragments with the implementation for the image resizing in the {{< next-in-section "next article" >}}.  

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
Finally we are able to define the CloudFront distribution.
Plenty of configuration options for different uses cases. 
We will not explain all of the here, but recommend to thoroughly read the documentation. List the important point that we do to build up the distribution. 

1. Origin -> The S3 Bucket we defined in the beginning.
2. Forwarded values -> Define that we want to forward the width and height query parameters and also use them as cache keys so that a resizing call with the same parameters is put into the CloudFront cache.
3. Default Cache Behavior -> Defining the default cache behavior of CloudFront -> This is where we associate both Lambda functions to their respective trigger points.
4. Defining the distribution itself using all values defined in points 1. - 3.  
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

At the end of our infrastructure code we define some outputs. These are not necessary in our case, but Pulumi will log the values in the deployment.  

```fsharp
    dict [ ("BucketName", bucket.Id :> obj)
           ("Distribution", cloudFrontDistribution.Id :> obj)
           ("LambdaRole", lambdaRole.Arn :> obj)
           ("OriginAccessIdentity", originAccessIdentity.IamArn :> obj)
           ("ViewerRequestLambda", viewerRequestLambda.Arn :> obj)
           ("OriginResponseLambda", originResponseLambda.Arn :> obj)
           ("ImageBucketPolicy", imageBucketPolicy.Id :> obj) ]
``` 
