+++
author = "Simon Schoof"
title = "Pulumi, CloudFront & Lambda@Edge: Lambda"
date = "2022-06-30"
description = "Implement AWS Lambda@Edge functions with typescript"
tags = [
    "infrastructure as code", 
    "pulumi",
    "aws",
    "typescript"
]
series = "CloudFront and Lambda@Edge with Pulumi"
draft = false
+++
This post is part of a small series of articles on using Pulumi to leverage CloudFront and Lambda@Edge for on the fly image resizing. The code for this part can be found [here](https://github.com/simonschoof/lambda-at-edge-example/tree/main/lambda). 
{{< series "CloudFront and Lambda@Edge with Pulumi" >}}

This part shows how to implement and build the Lambda@Edge functions for the `viewer request` and `origin response` functions. As shown in the figure below, the viewer request function is responsible for parsing and validating the query parameters `width` and `height`. It also checks if the image is in the CloudFront cache and returns the image from the cache if it is available. The origin response function is responsible for resizing the image if resizing parameters have been added to the query.


{{< figure2 src="images/cloudfront_lambda_workflow.svg" class="cloudfront-lambda-workflow" caption="CloudFront lambda workflow. Modified [original image](https://d2908q01vomqb2.cloudfront.net/5b384ce32d8cdef02bc3a139d4cac0a22bb029e8/2018/02/20/Social-Media-Image-Resize-Images.png)" attrrel="noopener noreferrer" >}} 

In the following sections of this post we will: 
* Explain the project's folder structure, which is important for integrating the Lambda@Edge functions into the CloudFront distribution. 
* Show how to implement the viewer request and origin response functions. 
* Show how to build the viewer request and origin response functions. 

### Project Structure

For clarity, we place the Lambda@Edge function code in separate folders and will use the folder structure shown below to integrate the functions into the CloudFront distribution. Therefore, we reference the `dist` folders of the functions in a relative path in the function definitions in our Pulumi code. 
 

```
.
|
└───lambda
│   │
│   └───origin-response-function
│   |   └───dist
│   |   │   index.js
│   |   │   
│   |   └───node_modules   
|   |   
│   └───viewer-request-function
│       └───dist
│           index.js  
│   
└───pulumi
```

As we can see in the snippet below and have also seen in the {{< prev-in-section "previous article" >}}, we have inlined the viewer request function code which does nothing more than return the original viewer request.  

```fsharp
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
```

We will replace the inlined function code in the Lambda function definition with an [`AssetArchive`](https://www.pulumi.com/docs/intro/concepts/assets-archives/) containing the function code and pointing to the `dist` folder of the viewer request function. 


```fsharp
Code =
    input (
        AssetArchive(
            Map<string, AssetOrArchive> [ (".", FileArchive("../lambda/viewer-request-function/dist")) ]
        )
    )
```

We also inlined the code for the origin response function, but this time returned the CloudFront response.

```fsharp
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
```

For the origin response function we will also replace the inlined function code with an [`AssetArchive`](https://www.pulumi.com/docs/intro/concepts/assets-archives/) that contains the function code and points to the `dist` folder of the origin response function. Note that we added the `node_modules` folder to the archive because the origin response function depends on the [Sharp library](https://sharp.pixelplumbing.com/), which we will use to resize the images.


```fsharp
Code =
    input (
        AssetArchive(
            Map<string, AssetOrArchive>
                [ (".", FileArchive("../lambda/origin-response-function/dist")); 
                ("node_modules", FileArchive("../lambda/origin-response-function/node_modules")) ]
        )
    )
```

### Viewer Request Function

##### Implementation

The viewer request function is linked to the corresponding CloudFront trigger point. The function is triggered when a viewer requests an image from CloudFront. Within the viewer request function, we want to parse and validate the resize parameters "width" and "height" from the viewer request. If the request parameters are not specified, the original image will be returned. Therefore, the steps for implementing the viewer request function are as follows:

1. Intercept the query of the viewer.
2. Parse the query parameters `width` and `height`.
3. Validate the query parameters.
    * `width` and `height` must be numbers.
    * `width` and `height` must be positive integers.
    * `width` and `height` must be less than or equal to the maximum allowed image width and height.
4. Return the request with valid resizing parameters or the original image if the resizing paramters where incorrect.

```typescript
import { CloudFrontRequest } from "aws-lambda";

interface ResizeParameters {
    width: number;
    height: number;
}

const AllowedDimensions = {
    maxWidth: 10000,
    maxHeight: 10000,
}

export async function handler(event: { Records: { cf: { request: any; } }[]; }): Promise<CloudFrontRequest> {
    console.log("Entering viewer request");
    const request = event.Records[0].cf.request;
    const urlsSearchParams = new URLSearchParams(request.querystring);

    console.log("Fetching image url", request.uri);

    const params = parseParams(urlsSearchParams);

    if (paramsValid(params)) {
        console.log("Provided dimensions: width: " + params.width + " height: " + params.height);
        console.log("Request querystring: ", request.querystring);
    } else {
        console.log("No dimension or invalid dimension params found, returning original image");
        request.querystring = "";
        console.log("New request querystring: ", request.querystring);
    }

    return request;
}

function parseParams(params: URLSearchParams): ResizeParameters {
    const widthString = params.get('width');
    const heightString = params.get('height');

    const width: number = widthString ? parseInt(widthString, 10) : NaN;
    const height: number = heightString ? parseInt(heightString, 10): NaN; 

    const resizerParams: ResizeParameters = {
        width: width,
        height: height,
    }
    return resizerParams

}

function paramsValid(params: ResizeParameters) {
    return !isNaN(params.width) 
    && !isNaN(params.height)
    && params.width > 0 
    && params.height > 0
    && params.width <= AllowedDimensions.maxWidth
    && params.height <= AllowedDimensions.maxHeight;
}
```

##### Build

To build the viewer request function, we can simply run the following command locally:
 
```bash
npm install && tsc --build 
```

### Origin Response Function

##### Implementation

The origin response function is associated with the corresponding CloudFront trigger point. The function is triggered when a response is returned from the CloudFront origin. Within the origin response function, we want to resize the image and return the resized image. Therefore, the steps for implementing the origin response function are as follows:

1. Intercepts the origin response and checks if resizing parameters are provided. If not, the original response is returned.
2. Retrieve the image from the S3 bucket.
3. Resize the image using Sharp and the resize parameters provided.
4. Return the resized image.


```typescript
import { CloudFrontResultResponse } from "aws-lambda";
import { GetObjectCommand, GetObjectCommandInput, GetObjectCommandOutput, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import sharp from "sharp"; 

const BUCKET_NAME = "images-76b39297-2c72-426d-8c2e-98dc34bfcbe9-eu-central-1";

export async function handler(event: { Records: { cf: { response: any; request: any; } }[]; }): Promise<CloudFrontResultResponse> {
    console.log("Entering origin response function");
    const { response, request } = event.Records[0].cf

    if (response.status !== '200') {
        console.log("Response status is not 200, returning");
        return response;
    }

    console.log("Response status", response.status);

    if (request.querystring === '') {
        console.log("No querystring, returning");
        return response;
    }

    const query = new URLSearchParams(request.querystring);
    const width = parseInt(query.get('width')!!, 10);
    const height = parseInt(query.get('height')!!, 10);

    console.log("Resizing image to", width, height);

    // 1. Get the image from S3
    const s3Key = request.uri.substring(1);
    console.log("S3 key:", s3Key);
    const cmd = new GetObjectCommand({ Key: s3Key, Bucket: BUCKET_NAME });
    const s3 = new S3Client({region: 'eu-central-1'});
    
    const s3Response = await s3.send<GetObjectCommandInput, GetObjectCommandOutput>(cmd);

    if (!s3Response.Body) {
        throw new Error(`No body in response. Bucket: ${BUCKET_NAME}, Key: ${s3Key}`);
    }

   const imageBuffer = Buffer.from(await new Promise<Buffer>((resolve, reject) => {
        const chunks:any = [];
        s3Response.Body.on('data', (chunk: any) =>  chunks.push(chunk));
        s3Response.Body.on('error', reject);
        s3Response.Body.on('end', () => resolve(Buffer.concat(chunks)));
    }));      

  
    // 2. Resize the image
    const resizedImage = await sharp(imageBuffer).resize({ width, height }).toBuffer()
    const resizedImageResponse = resizedImage.toString('base64');

    // 3. Return the image to CloudFront
    return {
        status : '200',
        body : resizedImageResponse,
        bodyEncoding : 'base64'
    }
}
```

##### Build

 Since the origin response function uses the [Sharp library](https://sharp.pixelplumbing.com/), which requires the [`libvips` native extension](https://sharp.pixelplumbing.com/install), we cannot simply build the function locally. We need to build and package the function for the Lambda execution environment. We can do this by using the [Amazon Linux Docker image](https://hub.docker.com/_/amazonlinux/), defining a [Dockerfile](https://github.com/simonschoof/lambda-at-edge-example/blob/main/lambda/origin-response-function/Dockerfile) and building the function with the following commands: 


```bash
docker build --tag amazonlinux:nodejs .  
```

```bash
docker run --rm --volume ${PWD}:/build amazonlinux:nodejs /bin/bash -c "source ~/.bashrc; npm init -f -y; rm -rf node_modules; npm install; npm run build"
```
