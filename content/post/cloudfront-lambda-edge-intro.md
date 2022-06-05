+++
author = "Simon Schoof"
title = "Pulumi, Cloudfront & lambda@edge: Introduction"
date = "2022-06-01"
description = "Setup AWS CloudFront and AWS lambda@edge with Pulumi"
tags = [
    "infrastructure as code", 
    "pulumi",
    "aws",
    "fsharp"
]
series = "CloudFront and lambda@edge with Pulumi"
draft = true
+++

After writing my [first article about my first steps in F#]({{< relref "/post/first-steps-fsharp.md" >}}
), I was thinking about which project I would like to do next. I decided to continue with F# but in a different setting. I would like to use F# with Pulumi to setup CloudFront and lambda@edge to resize images on the fly. Therefore I followed the blog post from [Amazon](https://aws.amazon.com/blogs/networking-and-content-delivery/resizing-images-with-amazon-cloudfront-lambdaedge-aws-cdn-blog/) where they setup a simple image resizing service with CloudFront and lambda@edge but using CloudFormation instead of Pulumi. I also simplified the lambda@edge functions by reducing the functionality of the resizing. Finally I am also using TypeScript to write the lambda@edge functions instead of JavaScript.

As the original blog post from Amazon is quite long I want to break up the article into multiple parts:

{{< series "CloudFront and lambda@edge with Pulumi" >}} 


So in this article we give a brief introduction to CloudFront and lambda@edge. In the second part we will show ho to setup the infrastructure with Pulumi. In the third part we will implement the resizing functions using TypeScript. Last but not least we will show how to deploy the resizing service to AWS using Pulumi and GitHub Actions.

### CloudFront and lambda@edge

https://github.com/pulumi/pulumi/issues/3644
https://aws.amazon.com/blogs/networking-and-content-delivery/resizing-images-with-amazon-cloudfront-lambdaedge-aws-cdn-blog/
https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html

https://aws.amazon.com/blogs/aws/introducing-cloudfront-functions-run-your-code-at-the-edge-with-low-latency-at-any-scale/

* Use OIA to restrict access to the S3 bucket

* Create Provider for us-east-1 region for lambda -> lambda@edge needs to be there

* Further S3 Security considerations
  * Only SSL Connections
  * Disable Public Object access
  * Use Signed URLs/Cookies
  * Geo Restrictions
  * WAF
  * Denial of Wallet Attack

* Provide S3 egion Domain URL otherwise CF seems to redirect to S3 URl

* versioning
* lambda@edge restrictions
* pulumi state in own backend 
* missing tests unit/acceptance/smoke
* build for aws lambda environment with amazon linux 2 docker image

{{< series "CloudFront and lambda@edge with Pulumi" >}}
