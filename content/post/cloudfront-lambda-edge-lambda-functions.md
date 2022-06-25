+++
author = "Simon Schoof"
title = "Pulumi, CloudFront & Lambda@Edge: Lambda"
date = "2022-06-03"
description = "Implement AWS Lambda@Edge functions with typescript"
tags = [
    "infrastructure as code", 
    "pulumi",
    "aws",
    "aws lambda",
    "fsharp"
]
series = "CloudFront and Lambda@Edge with Pulumi"
draft = true
+++
This post is part of a small article series about facilitating CloudFront and Lambda@Edge with Pulumi for on-the-fly image resizing. The code for this part can be found [here](https://github.com/simonschoof/lambda-at-edge-example/tree/main/lambda). 
{{< series "CloudFront and Lambda@Edge with Pulumi" >}}

In this part we will show how to implement and build the Lambda@Edge functions for the viewer request and origin response functions.

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

```fsharp
Code =
    input (
        AssetArchive(
            Map<string, AssetOrArchive> [ (".", FileArchive("../lambda/viewer-request-function/dist")) ]
        )
    )
```

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

```fsharp
Code =
    input (
        AssetArchive(
            Map<string, AssetOrArchive>
                [ (".", FileArchive("../lambda/origin-response-function/dist")); ("node_modules", FileArchive("../lambda/origin-response-function/node_modules")) ]
        )
    )
```

```typescript
import { CloudFrontRequest } from "aws-lambda";

interface ResizeParameters {
    width?: number;
    height?: number;
}

const AllowedDimensions = {
    maxWidth: 1000,
    maxHeight: 1000,
}

export async function handler(event: { Records: { cf: { request: any; } }[]; }): Promise<CloudFrontRequest> {
    console.log("Entering viewer request");
    const request = event.Records[0].cf.request;
    const urlsSearchParams = new URLSearchParams(request.querystring);

    console.log("Fetching image url", request.uri);

    const params = parseParams(urlsSearchParams);

    if (!validateParams(params)) {
        console.log("Provided dimensions: width: " + params.width + " height: " + params.height);
        console.log("Request querystring: ", request.querystring);

        request.querystring = `width=${params.width}&height=${params.height}`;
        console.log("New request querystring: ", request.querystring);

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

    if (widthString === null || heightString === null) {
        const resizerParams: ResizeParameters = {
            width: undefined,
            height: undefined,
        }
        return resizerParams
    }

    const width: number = (parseInt(widthString, 10) || AllowedDimensions.maxWidth) > AllowedDimensions.maxWidth ?
        AllowedDimensions.maxWidth : parseInt(widthString, 10);
    const height: number = (parseInt(heightString, 10) || AllowedDimensions.maxHeight) > AllowedDimensions.maxHeight ?
        AllowedDimensions.maxHeight : parseInt(heightString, 10);

    const resizerParams: ResizeParameters = {
        width: width,
        height: height,
    }
    return resizerParams

}

function validateParams(params: ResizeParameters) {
    return !params.width || !params.height || params.width <= 0 || params.height <= 0;
}
```

```bash
docker build --tag amazonlinux:nodejs .  
```

```bash
docker run --rm --volume ${PWD}:/build amazonlinux:nodejs /bin/bash -c "source ~/.bashrc; npm init -f -y; rm -rf node_modules; npm install; npm run build"
```

```bash
export SHARP_IGNORE_GLOBAL_LIBVIPS=true
rm -rf node_modules/sharp 
npm install  --unsafe-perm --arch=x64 --platform=linux --target=14.19.0 sharp
```

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