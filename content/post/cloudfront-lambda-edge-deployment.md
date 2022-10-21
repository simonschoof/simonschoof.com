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
This post is part of a small series of articles on using Pulumi to leverage CloudFront and Lambda@Edge for on the fly image resizing. The code for this part can be found [here](https://github.com/simonschoof/lambda-at-edge-example/tree/main/pulumi-identity-federation) and [here](https://github.com/simonschoof/lambda-at-edge-example/tree/main/.github/workflows).

{{< series "CloudFront and lambda@edge with Pulumi" >}} 

In this part, we will set up a deployment pipeline with GitHub Actions so that we can automate the the deployment of the infrastructure and AWS Lambda functions defined in the previous articles. To allow for secure deployments to AWS we will first configure OpenID connect in AWS. After we enabled GitHub Actions to deploy to AWS, using OIDC, we define the GitHub Actions workflows to create the AWS infrastructure and to build and deploy the AWS Lambda functions. At the end we will discuss options on how to improve the pipeline.    

### Configuring OpenID Connect in AWS #

Since October 2021 GitHub supports [OpenID Connect (OIDC) for secure deployments in the cloud](https://github.blog/changelog/2021-10-27-github-actions-secure-cloud-deployments-with-openid-connect/). Using this feature allows us to use short-lived tokens that are automatically rotated for each deployment instead of storing long-lived AWS credentials in GitHub. In this section we will create the neccessary resources in AWS to allow for secure cloud deployment workflows without needing any cloud secrets stored in GitHub. We will not go into much detail on how this works but one can find plenty of information about the topic, e.g. [here](https://github.blog/changelog/2021-10-27-github-actions-secure-cloud-deployments-with-openid-connect/
), [here](https://scalesec.com/blog/identity-federation-for-github-actions-on-aws/
) and [here](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html). 
Nevertheless in the following we will describe the needed resources to create with Pulumi to enable secure deployments fron within GitHub Actions into AWS. 
The code belonging to this section can be found [here](https://github.com/simonschoof/lambda-at-edge-example/tree/main/pulumi-identity-federation)

The first ressource we need to allow deployments from GitHub Actions into AWS is the OICD provider itself.

```fsharp
let openIdConnectProviderArgs = OpenIdConnectProviderArgs(
    Url = "https://token.actions.githubusercontent.com",
    ClientIdLists = inputList [input "sts.amazonaws.com"],
    ThumbprintLists = inputList [input "6938fd4d98bab03faadb97b34396831e3780aea1"])

let openIdConnectProvider = OpenIdConnectProvider("GithubOidc", openIdConnectProviderArgs)

let federatedPrincipal =
  GetPolicyDocumentStatementPrincipalInputArgs(Type = "Federated", Identifiers = inputList [ io openIdConnectProvider.Arn])
```

In addition to the OICD provider we have to create a policy in which we define the allowed actions we can execute in our deployment workflow. For our example we need access to CloudFront, S3, Lambda and IAM. In a real world project it would be good practice to neglect the access to all ressources with the "*" operator and just define the actions which are realy needed following the [principle of least privilege](https://en.wikipedia.org/wiki/Principle_of_least_privilege). 

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

The last thing we create is a role which can be used by our deployment pipeline and that tells IAM that this role can be assumed by GitHub Actions in our repository. It is important to define the condition, in the policy document statement, to restrict the access to the wanted repository. Otherwise every workflow in GitHub could assume this role. 

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


### Deployment pipeline with GitHub Actions

### Conclusion


For this article:

https://www.pulumi.com/docs/guides/continuous-delivery/github-actions/
https://github.com/actions/upload-artifact
https://github.com/actions/download-artifact
https://github.com/pulumi/actions
https://github.com/marketplace/actions/delete-run-artifacts
https://github.com/actions/cache
https://levelup.gitconnected.com/github-actions-how-to-share-data-between-jobs-fc1547defc3e



* use OICD provider for AWS still using log term credentials for pulumi

* add pulumi up to infrastructure text
* add reference on deployment text to lambda part


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

* Deployment takes log for Cloudfront to propagate the changes to the edge locations
* Upload of the origin respsone function takes long -> therefore maybe just build function if something changed otherwise return success in and
* use caching instead of articfact up and downloading
* cleanup artifacts after deployment
* missing tests unit/acceptance/smoke

{{< series "CloudFront and lambda@edge with Pulumi" >}}

