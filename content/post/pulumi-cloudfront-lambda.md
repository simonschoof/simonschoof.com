+++
author = "Simon Schoof"
title = "Pulumi, Cloudfront and lambda@edge"
date = "2022-02-10"
description = "Setup AWS CloudFront and AWS lambda@edge with Pulumi"
tags = [
    "infrastructure as code", 
    "fsharp",
    "pulumi",
    "aws"
]
draft = true
+++
Spin up Cloudfront and lambda@edge with pulumi in F#.  

https://github.com/pulumi/pulumi/issues/3644
https://aws.amazon.com/blogs/networking-and-content-delivery/resizing-images-with-amazon-cloudfront-lambdaedge-aws-cdn-blog/

https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html

* Use OIA to restrict access to the S3 bucket

* Create Provider for us-east-1 region for lambda -> lambda@edge needs to be there

* Further S3 Security considerations
  * Only SSL Connections
  * Disable Public Object access
  * Use Signed URLs/Cookies
  * Geo Restrictions
  * WAF
  * Denial of Wallet Attack

* Provide S3 Region Domain URL otherwise CF seems to redirect to S3 URl
