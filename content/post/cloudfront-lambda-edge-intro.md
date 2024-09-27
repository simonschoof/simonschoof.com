+++
author = "Simon Schoof"
title = "Pulumi, CloudFront & Lambda@Edge: Introduction"
date = "2022-06-28"
description = "Setup AWS CloudFront and AWS Lambda@Edge with Pulumi"
tags = [
    "infrastructure as code", 
    "pulumi",
    "aws",
    "fsharp"
]
series = "cloudfront and lambda@edge with pulumi"
draft = false
+++

After writing my [first article about my first steps in F#]({{< relref "/post/first-steps-fsharp.md" >}}
), I thought about what project I would like to tackle next. I decided to continue with [F#](https://fsharp.org/), but in a different environment. I want to use F# with [Pulumi](https://www.pulumi.com/) to set up [CloudFront and Lambda@Edge to resize images on the fly](https://aws.amazon.com/blogs/networking-and-content-delivery/resizing-images-with-amazon-cloudfront-lambdaedge-aws-cdn-blog/). 

So I followed [Amazon`s blog post](https://aws.amazon.com/blogs/networking-and-content-delivery/resizing-images-with-amazon-cloudfront-lambdaedge-aws-cdn-blog/) where they set up a simple service to resize images with CloudFront and Lambda@Edge, but used CloudFormation instead of Pulumi. I also simplified the Lambda@Edge functions by reducing the functionality. Finally, I also use TypeScript to write the Lambda@Edge functions instead of JavaScript.

Since the original blog post from Amazon is quite long, I decided to write a small series of articles on setting up CloudFront and Lambda@Edge with Pulumi.

{{< series "cloudfront and lambda@edge with pulumi" >}} 


In this article we give a brief introduction to CloudFront and Lambda@Edge. In the second part, we will show how to set up the infrastructure with Pulumi. In the third part, we will implement the resizing features using TypeScript. Last but not least, we will show how to deploy the resizing service on AWS using Pulumi and GitHub Actions.
All the code can be found in [this Git repository on Github](https://github.com/simonschoof/lambda-at-edge-example).   

### CloudFront and Lambda@Edge

[CloudFront is a content delivery network (CDN) service provided by Amazon](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html). It can be used to distribute static and dynamic content, such as .html, .css, .js, and image files, to end users. To ensure that the content can be delivered to the end users with the lowest latency, CloudFront uses a combination of network and cache servers located in multiple data centers around the world. One such data center is called a CloudFront edge location. When an end user now tries to request content from CloudFront, CloudFront sends the request to the CloudFront edge location that is closest to the end user and tries to get the content from there.<cite>[^1]<cite> If the content is not available in the CloudFront edge location, CloudFront sends the request to the CloudFront origin, which can be an Amazon Simple Storage Service (Amazon S3) bucket or a custom origin. CloudFront then stores the content at the CloudFront edge location. The content is then delivered to the end user. CloudFront's cache has [a variety of options](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ConfiguringCaching.html) to control the caching behavior of the content. 
Configuring CloudFront's cache behavior is the point at which a Lambda function can be connected to CloudFront, becoming a Lambda@Edge function. There are four trigger points in CloudFront where the request or response can be changed:

1. Viewer Request -> Executes on a viewer request before checking the cache
2. Origin Request -> Executes on an origin request before sending the request to the origin
3. Origin Response -> Executes on an origin response before sending the response to the cache
4. Viewer Response -> Executes on a viewer response before sending the response to the user

{{< figure2 src="images/cloudfront_trigger_points.svg" class="cloudfront-trigger-points" caption="CloudFront trigger points. Modified [original image](https://d2908q01vomqb2.cloudfront.net/5b384ce32d8cdef02bc3a139d4cac0a22bb029e8/2018/02/01/1.png) " attrrel="noopener noreferrer" >}} 

For more information on trigger points, see the original post from [Amazon](https://aws.amazon.com/blogs/networking-and-content-delivery/resizing-images-with-amazon-cloudfront-lambdaedge-aws-cdn-blog/) and the [Developer`s Guide](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-cloudfront-trigger-events.html).


For our example, we will extend the CloudFront behavior by associating Lambda functions with the trigger points of the viewer request and the origin response. In the viewer request, we will check if the resize parameters are set in the query string and if they are within a certain limit. If the resize parameters are correct, it checks if the image is already cached at the CloudFront Edge location. If the image is cached, the cached image is returned. If the image is not cached, we send the request to the origin, resize the image, and store it in the CloudFront edge location cache. As mentioned earlier, the example here is a bit simpler than the one provided by Amazon. For example, we will not store the resized images in the S3 bucket. Before starting with CloudFront and Lambda@Edge, you should take a look at the [restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-restrictions.html) and [quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html#limits-lambda-at-edge) on Lambda@Edge functions, to check if Lambda@Edge is sufficient for the use case at hand.


{{< figure2 src="images/cloudfront_lambda_workflow.svg" class="cloudfront-lambda-workflow" caption="CloudFront lambda workflow. Modified [original image](https://d2908q01vomqb2.cloudfront.net/5b384ce32d8cdef02bc3a139d4cac0a22bb029e8/2018/02/20/Social-Media-Image-Resize-Images.png)" attrrel="noopener noreferrer" >}} 

In the {{< next-in-section "next part" >}}, we will set up the necessary AWS infrastructure using [Pulumi](https://www.pulumi.com/).


[^1]: In May 2021, Amazon introduced [CloudFront Functions](https://aws.amazon.com/blogs/aws/introducing-cloudfront-functions-run-your-code-at-the-edge-with-low-latency-at-any-scale/), which allows lightweight functions to run directly at the edge location instead of in the regional edge cache. CloudFront Functions are cheaper and have a higer performance than Lambda@Edge functions, but are limited to the use case of lightweight web request processing and are subject to even tighter constraints and quotas.