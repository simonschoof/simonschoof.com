+++
author = "Simon Schoof"
title = "Pulumi, CloudFront & Lambda@Edge: Deployment"
date = "2022-06-04"
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
Deploy to AWS via GitHub Actions using OICD
{{< series "CloudFront and lambda@edge with Pulumi" >}} 

https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html
https://github.com/pulumi/pulumi/issues/3644
https://aws.amazon.com/blogs/networking-and-content-delivery/resizing-images-with-amazon-cloudfront-lambdaedge-aws-cdn-blog/1111
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

