+++
author = "Simon Schoof"
title = "Pulumi, CloudFront & Lambda@Edge: Infrastructure"
date = "2022-06-29"
description = "Setup AWS CloudFront and AWS Lambda@Edge with Pulumi"
tags = [
    "infrastructure as code", 
    "pulumi",
    "aws",
    "fsharp"
]
series = "CloudFront and Lambda@Edge with Pulumi"
draft = false
+++
This post is part of a small series of articles on using Pulumi to leverage CloudFront and Lambda@Edge for on the fly image resizing. The code for this part can be found [here](https://github.com/simonschoof/lambda-at-edge-example/tree/main/pulumi). 
{{< series "CloudFront and Lambda@Edge with Pulumi" >}}  

In this part, we will define the necessary AWS infrastructure using [Pulumi with F#](https://www.pulumi.com/docs/intro/languages/dotnet/). How to set up [Pulumi](https://www.pulumi.com/docs/get-started/) is not part of this article. Neither is explaining [Pulumi`s architecture and concepts](https://www.pulumi.com/docs/intro/concepts/). One important concept of Pulumi that should be mentioned is [inputs and outputs of resources](https://www.pulumi.com/docs/intro/concepts/inputs-outputs/). It is important to understand this concept in order to define an infrastructure with Pulumi. Unfortunately, F#'s type system is more rigid than C#'s and requires explicit type conversions for Pulumi's input and output types. To accomplish this in a more idiomatic way in F#, there are [helper functions](https://github.com/pulumi/pulumi/blob/master/sdk/dotnet/Pulumi.FSharp/Library.fs), [libraries](https://github.com/UnoSD/Pulumi.FSharp.Extensions), and [discussions](https://github.com/pulumi/pulumi/issues/3644) on how to get to a more idiomatic experience with Pulumi and F#. In this article we will use only the helper functions.
As for setting up Pulumi for this small project, we will use the default Pulumi configuration for a single developer and also use the [Pulumi Service as a backend](https://www.pulumi.com/docs/intro/concepts/state/) to store the state of the infrastructure. 



### Infrastructure 

##### S3

As we saw in the {{< prev-in-section "previous article" >}}  CloudFront requires an origin from which it can retrieve the content before it can be stored in the regional cache. This can be a custom origin or an S3 bucket. We will choose an S3 bucket because we want to define the infrastructure within AWS.
Therefore, we first define the origin bucket. We set the bucket to private to restrict public access to the bucket.
This is just an obvious security restriction. In a production environment, you will probably want to add additional layers of security: 

  * SSL only connections
  * Disabled public object access
  * Using signed URLs or cookies
  * Geographic restrictions
  * A Web Application Firewall to prevent [Denial of Wallet](https://medium.com/geekculture/denial-of-wallet-attack-3d8ecadfbd4e) attacks

We also specify a constant bucket name, since we want to reference the bucket in our Lambda@Edge functions.

```fsharp
let bucket =
    let bucketName =
        "images-76b39297-2c72-426d-8c2e-98dc34bfcbe9-eu-central-1"
    
    let bucketArgs =
        BucketArgs(Acl = "private", BucketName = bucketName)
    
    Bucket(bucketName, bucketArgs)
```

##### IAM

In the second step, we define our IAM policies to allow CloudFront and the AWS Lambda functions to access the AWS S3 bucket.

To do this, we create the following resources:
1. [An Origin Access Identity](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html) -> This is a special CloudFront user that we can use to access the private S3 bucket.
2. [A AWS Lambda execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html) -> With permission to invoke the AWS Security Token Service AssumeRole action.
3. [Two Principals](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html) -> One for Lambda and one for CloudFront. 
4. [A AWS S3 Bucket policy](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-policy-language-overview.html) -> In the policy, we grant Lambda and CloudFront permissions to access the AWS S3 bucket. 

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

In the third step, we define two lambda functions for the trigger points of the origin response and the viewer request. There are some points we want to emphasize when defining the lambda functions:

1. [US East](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-restrictions.html) -> The lambda function must be located in the region "us-east-1".
2. [Publish = true](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-how-it-works.html) ->  The `Publish` flag must be set to true so that a new version of the Lambda function is published when the Lambda function is created or updated. A Lambda function can only be associated with CloudFront with a specific version number.
3. [Code](https://www.pulumi.com/docs/intro/concepts/assets-archives/) -> We use an inlined Pulumi `StringAsset` for the `Code` parameter of the Lambda function definition. The inlined code fragments do nothing more than forward and return the CloudFront viewer request and origin response. We will replace the code fragments with the implementation for resizing the image in the {{< next-in-section "next article" >}}.  

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

Finally, we are able to define the CloudFront distribution.
As mentioned earlier, CloudFront has [a variety of configuration options](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ConfiguringCaching.html) for different use cases. 
We will not explain them here, but recommend reading the [documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html) thoroughly. Among the many options available for the distribution, we provide a brief overview of the steps we will take to build the distribution:

1. [Origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html#using-s3-as-origin) -> We use the S3 bucket we created earlier as the source<cite>[^1]<cite>.
2. [Cache keys](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/controlling-the-cache-key.html) -> Within CloudFront, you can control the cache key for objects that are cached at CloudFront edge locations. We use the `CacheKey` parameter to specify which query string parameters to include in the cache key. In our case, we will use the `width` and `height` parameters.
3. [Default cache behavior](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_DefaultCacheBehavior.html) -> We are using the Default Cache Behavior to define how CloudFront processes requests and serves content from the origin. This is also the point in which we will associate the Lambda functions with the distribution.

In the end, we will use the above parts in the CloudFront distribution definition. 

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

At the end of our infrastructure code we define some outputs. These are not necessary in our case, but Pulumi will log the values after deployment and we will have an overview of the resources we have created.
 
```fsharp
dict [ ("BucketName", bucket.Id :> obj)
        ("Distribution", cloudFrontDistribution.Id :> obj)
        ("LambdaRole", lambdaRole.Arn :> obj)
        ("OriginAccessIdentity", originAccessIdentity.IamArn :> obj)
        ("ViewerRequestLambda", viewerRequestLambda.Arn :> obj)
        ("OriginResponseLambda", originResponseLambda.Arn :> obj)
        ("ImageBucketPolicy", imageBucketPolicy.Id :> obj) ]
```
  
In the {{< next-in-section "next part" >}}, we show how to implement and build the Lambda@Edge functions using TypeScript. 

[^1]: Ensure that you use the `BucketRegionalDomainName` property instead of the `BucketDomainName` property when defining the origin. Otherwise, CloudFront redirects requests to the bucket domain and makes the origin unreachable when you work with a private bucket.
