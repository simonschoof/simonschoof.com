+++
author = "Simon Schoof"
title = "Pulumi, CloudFront & Lambda@Edge: Introduction"
date = "2022-06-01"
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

After writing my [first article about my first steps in F#]({{< relref "/post/first-steps-fsharp.md" >}}
), I was thinking about which project I would like to do next. I decided to continue with F# but in a different setting. I would like to use F# with Pulumi to setup CloudFront and Lambda@Edge to resize images on the fly. Therefore I followed the blog post from [Amazon](https://aws.amazon.com/blogs/networking-and-content-delivery/resizing-images-with-amazon-cloudfront-lambdaedge-aws-cdn-blog/) where they setup a simple image resizing service with CloudFront and Lambda@Edge but using CloudFormation instead of Pulumi. I also simplified the Lambda@Edge functions by reducing the functionality of the resizing. Finally I am also using TypeScript to write the Lambda@Edge functions instead of JavaScript.

As the original blog post from Amazon is quite long I want to break up the article into multiple parts:

{{< series "CloudFront and Lambda@Edge with Pulumi" >}} 


So in this article we give a brief introduction to CloudFront and Lambda@Edge. In the second part we will show ho to setup the infrastructure with Pulumi. In the third part we will implement the resizing functions using TypeScript. Last but not least we will show how to deploy the resizing service to AWS using Pulumi and GitHub Actions.

### CloudFront and Lambda@Edge

[CloudFront is a content delivery network (CDN) service provided by Amazon](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html). It can be used to distribute static and dynamic content, such as .html, .css, .js, and image files, to end users. To ensure that the content can be delivered to the end users with the lowest latency, CloudFront uses a combination of network and cache servers located in multiple data centers around the world. Such a data center is called a CloudFront edge location. When an end user now tries to request content from CloudFront, CloudFront sends the request to the CloudFront edge location that is closest to the end user and tries to get the content from there.<cite>[^1]<cite> If the content is not available in the CloudFront edge location, CloudFront sends the request to the CloudFront Origin, which can be an S3 bucket or a custom origin. CloudFront then caches the content in the CloudFront edge location. Afterwards the content is delivered to the end user. The cache of CloudFront has [plenty of options](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ConfiguringCaching.html) to control the caching behavior of the content. 
In this request flow, there exist 4 trigger points in which the request or response can be modified by associate a Lambda function with CloudFront, hence becoming a Lambda@Edge function. The following are the four CloudFront trigger points:

1. Viewer request -> Executes on viewer request before checking the cache
2. Origin request -> Executes on origin request before sending the request to the origin
3. Origin response -> Executes on origin response before sending the response to the viewer
4. Viewer response -> Executes on viewer response before sending the response to the user

{{< figure2 src="images/cloudfront_trigger_points.svg" class="cloudfront-trigger-points" caption="CloudFront trigger points. Modified [original image](https://d2908q01vomqb2.cloudfront.net/5b384ce32d8cdef02bc3a139d4cac0a22bb029e8/2018/02/01/1.png) " attrrel="noopener noreferrer" >}} 

Further information about the trigger points can be found in the original post by [Amazon](https://aws.amazon.com/blogs/networking-and-content-delivery/resizing-images-with-amazon-cloudfront-lambdaedge-aws-cdn-blog/).


For our example we will extend the CloudFront behaviour by associating Lambda functions with the viewer request and the origin response trigger points. In the viewer request we will check if the resizing parameters are set in the query string and if they are in a given limit. If correct resizing parameters are provided we will check if the image is already cached in the CloudFront edge location. If the image is cached we will return the cached image. If the image is not cached we will send the request to the origin and resize the image and cache it in the CloudFront edge location. As mentioned before, the example here is a bit more simple then the one provided by Amazon. For instance we will not store the resized images in the S3 Bucket. Finally should also have a look at the [restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-restrictions.html) and [quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html#limits-lambda-at-edge) on lambda@Edge functions, so that we can make sure that Lambda@Edge is sufficient for our use case. 

{{< figure2 src="images/cloudfront_lambda_workflow.svg" class="cloudfront-lambda-workflow" caption="CloudFront lambda workflow. Modified [original image](https://d2908q01vomqb2.cloudfront.net/5b384ce32d8cdef02bc3a139d4cac0a22bb029e8/2018/02/20/Social-Media-Image-Resize-Images.png)" attrrel="noopener noreferrer" >}} 


[^1]: In May 2021 Amazon [introduced CloudFront Functions](https://aws.amazon.com/blogs/aws/introducing-cloudfront-functions-run-your-code-at-the-edge-with-low-latency-at-any-scale/) that allows for running lightweight functions directly in the edge location instead of the regional edge cache. CloudFront Functions are cheaper and more performant then Lambda@Edge functions but are limited to the use case of lightweight processing of web requests and have even stricter restrictions and quotas.