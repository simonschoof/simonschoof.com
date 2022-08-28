+++
author = "Simon Schoof"
title = "Pulumi, CloudFront & Lambda@Edge: Deployment"
date = "2022-08-28"
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

For this article:

https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc_verify-thumbprint.html
https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services
https://github.com/github/roadmap/issues/249
https://github.blog/changelog/2021-10-27-github-actions-secure-cloud-deployments-with-openid-connect/
https://scalesec.com/blog/identity-federation-for-github-actions-on-aws/
https://www.pulumi.com/docs/guides/continuous-delivery/github-actions/
https://github.com/actions/upload-artifact
https://github.com/actions/download-artifact
https://github.com/pulumi/actions
https://github.com/marketplace/actions/delete-run-artifacts
https://github.com/actions/cache
https://levelup.gitconnected.com/github-actions-how-to-share-data-between-jobs-fc1547defc3e

* more Secure Setup for policy
* Deployment takes log for Cloudfront to propagate the changes to the edge locations
* Upload of the origin respsone function takes long -> therefore maybe just build function if something changed otherwise return success in and
* cleanup artifacts after deployment
* use caching instead of articfact up and downloading
* use OICD provider for AWS still using log term credentials for pulumi

* missing tests unit/acceptance/smoke


```fsharp
let cloudFrontPolicy =

      let cloudFrontStatement =
          GetPolicyDocumentStatementInputArgs(
              Actions = inputList [ input "cloudfront:*";
              input "s3:*";
              input "lambda:*";
              input "iam:*"],
              Resources =
                  inputList [ input "*" ]
          )


      let policyDocumentInvokeArgs =
          GetPolicyDocumentInvokeArgs(
              Statements =
                  inputList [ input cloudFrontStatement ]
          )

      let policyDocument =
          GetPolicyDocument.Invoke(policyDocumentInvokeArgs)

      let policyArgs =
          PolicyArgs(PolicyDocument = io (policyDocument.Apply(fun (pd) -> pd.Json)))

      Policy("cloudFrontPolicy", policyArgs)
```

```fsharp
let openIdConnectProviderArgs = OpenIdConnectProviderArgs(
    Url = "https://token.actions.githubusercontent.com",
    ClientIdLists = inputList [input "sts.amazonaws.com"],
    ThumbprintLists = inputList [input "6938fd4d98bab03faadb97b34396831e3780aea1"])

let openIdConnectProvider = OpenIdConnectProvider("GithubOidc", openIdConnectProviderArgs)

let federatedPrincipal =
  GetPolicyDocumentStatementPrincipalInputArgs(Type = "Federated", Identifiers = inputList [ io openIdConnectProvider.Arn])
```

```fsharp
let githubActionsRole =
  
  let assumeRoleWithWebIdentityStatement =
      GetPolicyDocumentStatementInputArgs(
          Principals =
              inputList [ input federatedPrincipal ],
          Actions = inputList [ input "sts:AssumeRoleWithWebIdentity" ],
          Conditions = inputList [
            input (GetPolicyDocumentStatementConditionInputArgs(
              Test = "StringLike",
              Variable = "token.actions.githubusercontent.com:sub",
              Values = inputList [ input "repo:simonschoof/lambda-at-edge-example:*"]
              ))
          ]
      )

  let policyDocumentInvokeArgs =
      GetPolicyDocumentInvokeArgs(
          Statements =
              inputList [ input assumeRoleWithWebIdentityStatement ]
      )
  let policyDocument =
      GetPolicyDocument.Invoke(policyDocumentInvokeArgs)

  Role("githubActionsRole",
    RoleArgs(
      Name= "githubActionsRole", 
      AssumeRolePolicy = io (policyDocument.Apply(fun (pd) -> pd.Json)),
      ManagedPolicyArns = inputList [ io cloudFrontPolicy.Arn])
      )
```

```yaml
name: Deploy CloudFront with Lambda@Edge

on:
  workflow_dispatch:
    branches:
      - main  # Set a branch to deploy

concurrency: cloudfront_deployment


jobs:
 build-viewer-request:
   name: Build  viewer request
   runs-on: ubuntu-latest
   defaults:
     run:
       working-directory: lambda/viewer-request-function
   steps:
     - uses: actions/checkout@v3
     - uses: actions/setup-node@v3 
       with:
        node-version: 14.x
     - name: Install dependencies
       run: npm ci --ignore-scripts
     - name: Build function 
       run: npm run build
     - uses: actions/upload-artifact@v3
       with:
         name: viewer-request-function
         path: lambda/viewer-request-function/dist/
```

```yaml
 build-origin-response:
   name: Build origin response
   runs-on: ubuntu-latest
   defaults:
     run:
       working-directory: lambda/origin-response-function
   steps:
     - uses: actions/checkout@v3
     - name: Install dependencies and build function
       run: | 
         docker build --tag amazonlinux:nodejs .
         docker run --rm --volume ${PWD}:/build amazonlinux:nodejs /bin/bash -c "source ~/.bashrc; npm init -f -y; rm -rf node_modules; npm ci --ignore-scripts; npm rebuild sharp; npm run build"
     - uses: actions/upload-artifact@v3
       with:
         name: origin-response-function
         path: |
           lambda/origin-response-function/dist/
           lambda/origin-response-function/node_modules
```

```yaml
 deploy:
   name: Deploy CloudFront & Lambda
   needs:
     - build-viewer-request
     - build-origin-response
   if: success()
   permissions:
     id-token: write
     contents: read
   runs-on: ubuntu-latest
   steps:
     - uses: actions/checkout@v3
     - uses: actions/download-artifact@v3
       with:
         name: viewer-request-function
         path: lambda/viewer-request-function/dist
     - uses: actions/download-artifact@v3
       with:
         name: origin-response-function
         path: lambda/origin-response-function
     - uses: actions/setup-dotnet@v2
       with:
         dotnet-version: 6.0.x
     - name: Configure AWS Credentials
       uses: aws-actions/configure-aws-credentials@master
       with:
         aws-region: eu-central-1
         role-to-assume: arn:aws:iam::424075716607:role/githubActionsRole
         role-session-name: GithubActionsSession
     - uses: pulumi/actions@v3
       with:
          work-dir: ./pulumi
          command: up
          stack-name: dev
       env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
```

{{< figure2 src="images/github_action_deployment_pipeline.png" class="github-action-deployment-pipeline" caption="Github Actions deployment pipeline " attrrel="noopener noreferrer" >}} 

{{< series "CloudFront and lambda@edge with Pulumi" >}}

