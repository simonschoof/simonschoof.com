+++
author = "Simon Schoof"
title = "Mastodon on AWS: Running locally"
date = "2023-03-11"
description = "Running Mastodon locally using Docker and docker-compose"
tags = [
    "mastodon",
    "docker",
    "docker-compose"
]
series = "Running Mastodon on AWS"
draft = true
+++
This post is the first part of a two article series on running a [Mastodon](https://joinmastodon.org/) instance on AWS with ECS and Fargate. To get familiar with Mastodon and its configuration, I decided to run Mastodon locally with [docker-compose](https://docs.docker.com/compose/) first. This post will cover the steps to run Mastodon locally with docker-compose. The second part will cover the steps to run Mastodon on AWS with ECS and Fargate.
The code for this part can be found [here](https://github.com/simonschoof/mastodon-aws).

{{< series "Running Mastodon on AWS" >}} 

### Introduction

As I was never a huge fan of the existing social media platforms, I was looking for an alternative for a while. I stumbled upon Mastodon and got interested in it and the idea of [building protocolls instead of platforms](https://knightcolumbia.org/content/protocols-not-platforms-a-technological-approach-to-free-speech). As I was searching for Mastodon instances, the idea to host my own instance came up. I also thought it could be a good next project to write a blog post about. As I used AWS for my last project already, I thought it might be interesting to also run Mastodon on AWS. 

Before I start with the AWS part, I wanted to get familiar with Mastodon and its configuration. Therefore I decided to run Mastodon locally with docker-compose first. In the next sections I will cover the steps to run Mastodon locally with docker-compose. To get Mastodon to run with docker-compose, I am thankful that I found the following blog posts of Ben Tasker and Peter Babič, which helped me a lot:
* https://www.bentasker.co.uk/posts/blog/general/running-mastodon-in-docker-compose.html#self_hosting
* https://peterbabic.dev/blog/running-mastodon-with-docker-compose/

In the next section I will describe the steps to adjust the docker-compose file to run Mastodon in a local setup for exploration and testing purposes.

### Adjusting to run locally

As I only want to run Mastodon locally for exploration and testing purposes, I will make some changes to the docker-compose file and the Nginx configuration and deviate from the setup described in the blog posts of [Ben Tasker](https://www.bentasker.co.uk/posts/blog/general/running-mastodon-in-docker-compose.html#self_hosting) and [Peter Babič](https://peterbabic.dev/blog/running-mastodon-with-docker-compose/). 

##### Docker-compose and env file

First, I will get the docker-compose file from the [Mastodon repository](https://github.com/mastodon/mastodon/blob/main/docker-compose.yml). There is no need to clone the whole repository, as the docker-compose file is the only file I need. Of cause you can also clone the repository and copy the docker-compose file from there.

The second file I need is the .env.production file. This file contains the environment variables for the docker-compose file. I can start with an empty file and add the variables I need later. Within a shell you can create the file with the following command:

```bash
touch .env.production
```

##### Remove build statements

In the second step I removed the build statements from the docker-compose file as we will use the pre-built images from the [Docker Hub](https://hub.docker.com/r/tootsuite/mastodon) instead of building the images locally.

Just replace the build statement in the docker-compose file

```yaml
build: .
```

with the following line

```yaml
image: tootsuite/mastodon:v4.1.1
```

The lastest image version to this time of this writing is v4.1.1.

##### Remove networks

In a third step I removed the internal and external networks from the docker-compose file as there is no need to distinguish between internal and external networks when running locally only.

Just remove the following lines from the docker-compose file:

```yaml
networks:
  - internal_network
  - external_network
```

and 

```yaml
etworks:
  external_network:
  internal_network:
    internal: true
```

I also removed the local host ip, `127.0.0.1`, in front of the port mappings and deleted the comments for the elasticsearch cluster and the allow hidden services federation configuration. This was not necessary, but I thought it would be cleaner to remove them.

##### Add Mailcatcher

To be able to send and receive emails locally, I will add [Mailcatcher](https://mailcatcher.me/) to the docker-compose file. Mailcatcher is a simple SMTP server which catches any message sent to it to display in a web interface. With Mailcatcher we can send emails locally on port 1025 and receive them on port 1080.

```yaml
mailcatcher:
  restart: always
  image: schickling/mailcatcher
  container_name: mastodon-mailcatcher
  ports:
    - 1025:1025
    - 1080:1080
```

##### Add Minio

To be able to upload media files to a local S3 compatible storage, I added [Minio](https://min.io/) to the docker-compose file. Minio is an open source object storage server compatible with Amazon S3 cloud storage service. With Minio we can upload media files locally on port 9000 and access the Minio console on port 9001. I was not able to use a local mock AWS S3 mock server, as it seems that the AWS S3 client used by Mastodon is hard wired to use the AWS S3 API endpoints. Hence, I had to use Minio instead.

```yaml
minio:
  restart: always
  image: minio/minio
  ports:
    - "9000:9000"
    - "9001:9001"
  volumes:
    - minio_storage:/data
  environment:
    MINIO_ROOT_USER: minio
    MINIO_ROOT_PASSWORD: minio123
  command: server --console-address ":9001" /data
```

##### Adjust Nginx configuration

In the last step of the preparation I will adjust the Nginx configuration to run Mastodon locally. I will use the Nginx configuration provided by [Ben Tasker](https://www.bentasker.co.uk/posts/blog/general/running-mastodon-in-docker-compose.html#self_hosting) and will configure it to run Mastodon on the local domain `social.localhost` with [self-signed certificates for this local domain](https://letsencrypt.org/docs/certificates-for-localhost/). To do so I created a new folder `nginx` and added the following subfolders:

* `conf.d` - contains the Nginx configuration files
* `certs` - contains the self-signed certificates
* `tmp` - contains the Nginx temporary files.
* `lebase` - don't know what this is for. Just copied it from Ben Tasker's setup.

The folders are mounted to the Nginx container as volumes. The Nginx container is configured as follows:

```yaml
http:
  restart: always
  image: nginx:1-alpine
  container_name: mastodon-nginx
  ports:
      - 443:443
      - 80:80
  volumes:
      - ./nginx/tmp:/var/run/nginx
      - ./nginx/conf.d:/etc/nginx/conf.d
      - ./nginx/certs:/etc/letsencrypt/
      - ./nginx/lebase:/lebase
```

To create the self-signed certificates I used the following command:

```bash
openssl req -x509 -out social.localhost.crt -keyout social.localhost.key \
  -newkey rsa:2048 -nodes -sha256 \
  -subj '/CN=social.localhost' -extensions EXT -config <( \
   printf "[dn]\nCN=social.localhost\n[req]\ndistinguished_name = dn\n[EXT]\nsubjectAltName=DNS:social.localhost\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth")
```

The created certificates are then placed in the `nginx/certs` folder.

The Nginx configuration file is called `mastodon.development.conf` and is placed in the `nginx/conf.d` folder and looks like this:

```conf
server {
        listen 80;
        listen   [::]:80; 

        root /lebase; 
        index index.html index.htm;

        server_name social.localhost;

        location ~ /.well-known/acme-challenge {
            try_files $uri $uri/ =404;
        }

        location / {
                return 301 https://$server_name$request_uri;                
        }
}

server {
        listen 443 ssl http2;
        listen [::]:443 ssl http2;
        root /mnt/none;
        index index.html index.htm;

        server_name social.localhost;

        ssl on;

        ssl_certificate      /etc/letsencrypt/social.localhost.crt;
        ssl_certificate_key  /etc/letsencrypt/social.localhost.key;

        ssl_session_timeout  5m;
        ssl_prefer_server_ciphers On;
        ssl_protocols TLSv1 TLSv1.1 TLSv1.2;

        absolute_redirect off;
        server_name_in_redirect off;

        error_page 404 /404.html;
        error_page 410 /410.html;

        location / {
            proxy_set_header Host $http_host;
            proxy_set_header X-Forwarded-Proto https;

            proxy_pass http://web:3000;
        }

        location ^~ /api/v1/streaming {
            proxy_set_header Host $http_host;
            proxy_set_header X-Forwarded-Proto https;

            proxy_pass http://streaming:4000;

            proxy_buffering off;
            proxy_redirect off;
            proxy_http_version 1.1;
            tcp_nodelay on;
        }
}
```
The main parts of the Nginx configuration file are doing the following:

* Redirects all HTTP requests to HTTPS
* Serves the Mastodon web application on port 3000
* Serves the Mastodon streaming API on port 4000. The path for the streaming API is `/api/v1/streaming`


### Prepare and run Mastodon

With the preparation done, we can now setup the Mastodon instance. To recap, we need to have the following in place:

* The adjusted docker-compose file
* An (empty) .env.production file
* The Nginx configuration file and the self-signed certificates

As also mentioned by Peter Babič, this part is a bit tricky, but we will see that it is a bit easier if we want to run Mastodon on a local domain only instead of running it in a docker environment in production.

To setup the Mastodon instance we need to run the following command:

```bash
docker-compose run --rm web bundle exec rake mastodon:setup DISABLE_DATABASE_ENVIRONMENT_CHECK=1
```

I added the `DISABLE_DATABASE_ENVIRONMENT_CHECK=1` to the command to be able to run the command all over again if I made a mistake. This is not recommended in production, but for a local setup it is fine.

The command will ask you a few questions and will then setup the Mastodon instance. We will go through the questions and the answers I used to setup Mastodon on the local domain `social.localhost`. I have split the questions intto several sections to make it easier to read and to be able to add comments on the different parts of the Mastodon setup.

Question | Answer | Default
--------|------|--------
Domain name | social.localhost | n/a 
Do you want to enable single user mode? | y | n
Are you using Docker to run Mastodon? | y | y

I enabled single user mode, because that is how I want to run my own instance for the start. I am thinking about opening it up to other users later on, but for now I want to keep it to myself. You can of course also run Mastodon locally in multi-user mode. The next step is to configure the database and Redis.

Question | Answer | Default
--------|------|--------
PostgreSQL host | db | db
PostgreSQL port | 5432 | 5432
Name of PostgreSQL database | mastodon | postgres
Name of PostgreSQL user | postgres | postgres
Password of PostgreSQL user | |

Setting up PostgreSQL is straight forward. After entering the values for the PostgreSQL setup you should see the following output: `Database configuration works! 🎆`

Question | Answer | Default
--------|------|--------
Redis host | redis | redis
Redis port | 6379 | 6379
Redis password | |

Setting up Redis is also straight forward. After entering the values for the Redis setup you should see the following output: `Redis configuration works! 🎆`

The next step is to configure the file storage. I am using Minio as the file storage. Here I am taking advantage on how Docker networks work. This is not very elegant, but it works for now. I am sure there is a better way to get a file storage up and running locally to use with Mastodon.

Question | Answer | Default
--------|------|--------
Do you want to store uploaded files on the cloud? | y | n
Provider | Choose Minio from the list | List choice
Minio endpoint URL | http://minio:9000 | 
Minio bucket name | files.social.localhost | files.`domain`
Minio access key | minio | minio
Minio secret key | minio123 | minio123
Do you want to access the uploaded files from your own domain | y | y

After the file storage is configured we need to configure the SMTP server. I am using Mailcatcher to catch all outgoing e-mails. 

Question | Answer | Default
--------|------|--------
Do you want to send e-mails from localhost | n | n
SMTP server | mailcatcher | 
SMTP port | 1025 | 587 
SMTP username | |
SMTP password | |
SMTP authentication | plain | plain
SMTP OpenSSL verify mode | none | List choice
Enable STARTTLS | auto | List choice
E-mail address to send e-mails "from" | Mastodon <notifications@social.localhost> | Mastodon <notifications@`domain`>
Send a test e-mail with this configuration right now | y | y
Send a test e-mail to | mail@social.localhost | 

The last question of the SMTP server configuration is to send a test e-mail. If everything is configured correctly we can open the Mailcatcher web interface on `http://localhost:1080` and see the test e-mail.

{{< figure2 src="images/mastodon-mailcatcher.webp" class="mastodon-mailcatcher" caption="Mastodon test email" attrrel="noopener noreferrer" >}}

Question | Answer | Default
--------|------|--------
Save configuration | y | y

When answering yes to the last question the configuration will be saved to the `.env.production` file within the currently running Docker container and will also be displayed on the screen. We can now copy the configuration to the `.env.production` file on our local machine.

```env
# Generated with mastodon:setup on 2023-03-19 21:16:41 UTC

# Some variables in this file will be interpreted differently whether you are
# using docker-compose or not.

LOCAL_DOMAIN=social.localhost
SINGLE_USER_MODE=true
SECRET_KEY_BASE=<secret>
OTP_SECRET=<secret>
VAPID_PRIVATE_KEY=<secret>
VAPID_PUBLIC_KEY=<secret>
DB_HOST=db
DB_PORT=5432
DB_NAME=mastodon
DB_USER=postgres
DB_PASS=
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=
S3_ENABLED=true
S3_PROTOCOL=http
S3_REGION=us-east-1
S3_ENDPOINT=http://minio:9000
S3_HOSTNAME=minio:9000
S3_BUCKET=files.social.localhost
AWS_ACCESS_KEY_ID=minio
AWS_SECRET_ACCESS_KEY=minio123
S3_ALIAS_HOST=localhost:9000/files.social.localhost
SMTP_SERVER=mailcatcher
SMTP_PORT=1025
SMTP_LOGIN=
SMTP_PASSWORD=
SMTP_AUTH_METHOD=plain
SMTP_OPENSSL_VERIFY_MODE=none
SMTP_ENABLE_STARTTLS=auto
SMTP_FROM_ADDRESS=Mastodon <notifications@social.localhost>
```

The last step for the Mastodon setup is to prepare the database and create an admin user.

Question | Answer | Default
--------|------|--------
Prepare the database now | y | y
Do you want to create an admin user straight away | y | y
Username | admin | admin
E-mail | admin@social.localhost | 

After preparing the database and creating the admin user we should see the following output:

```bash
You can login with the password: <generated password>
You can change your password once you login.
```

Copy the generated password and maybe store it somewhere safe. We will need it in a minute to login to the Mastodon instance.

To run mastodon we only need to run `docker-compose up` and we should be able to access the Mastodon instance on `https://social:localhost`<cite>[^1]<cite>. We can login with the username `admin` and the password we generated earlier. 

{{< figure2 src="images/mastodon-running-locally.webp" class="mastodon-running-locally" caption="Mastodon running on social.localhost" attrrel="noopener noreferrer" >}}


After logging in we can change the password of our admin user, add an avatar and a header image and write our first toots.

{{< figure2 src="images/mastodon-mastodon.webp" class="mastodon-first-toot" caption="Mastodon first toots" attrrel="noopener noreferrer" >}}

We can then check if the images are stored on the Minio instance by opening the Minio web interface on `http://localhost:9000` and checking the `files.social.localhost` bucket.

{{< figure2 src="images/mastodon-minio-bucket.webp" class="mastodon-minio" caption="Local Minio bucket" attrrel="noopener noreferrer" >}}

We can also see the path of the file when we open one of the images in the browser.

{{< figure2 src="images/mastodon-minio-filepath.webp" class="mastodon-minio" caption="Image file path for local Minio bucket" attrrel="noopener noreferrer" >}}

[^1]: You have to disable the security warning in your browser to be able to access the Mastodon instance. This is because we are using a self-signed certificate.