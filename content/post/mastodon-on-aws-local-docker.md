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

To be able to upload media files to a local S3 compatible storage, I added [Minio](https://min.io/) to the docker-compose file. Minio is an open source object storage server compatible with Amazon S3 cloud storage service. With Minio we can upload media files locally on port 9000 and access the Minio console on port 9001. I was not able to use a local mock AWS S3 mock server, as it seems that the AWS S3 client used by Mastodon is hard wired to use the AWS S3 API endpoints. 

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

In the last step of the preparation I will adjust the Nginx configuration to run Mastodon locally. I will use the Nginx configuration provided by [Ben Tasker](https://www.bentasker.co.uk/posts/blog/general/running-mastodon-in-docker-compose.html#self_hosting) and will configure it to run Mastodon on the local domain `social.localhost` with self-signed certificates for this local domain. To do so I created a new folder `nginx` and added the following subfolders:
* `conf.d` - contains the Nginx configuration files
* `certs` - contains the self-signed certificates
* `tmp` - contains the Nginx temporary files.
* `lebase` - don't know what this is for. Just copied it from Ben Tasker's setup.

The folder are mounted to the Nginx container as volumes. The Nginx container is configured as follows:

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

The Nginx configuration file is called `mastodon.development.conf` placed in the `nginx/conf.d` folder and looks like this:

```conf
server {
        listen 80;
        listen   [::]:80; 

        root /lebase; 
        index index.html index.htm;

        server_name social.localhost; # Replace with your domain name

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

        server_name social.localhost; # Replace with your domain name


        ssl on;

        # Replace your domain in these paths
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

### Prepare and run Mastodon

* https://letsencrypt.org/docs/certificates-for-localhost/
* https://www.bentasker.co.uk/posts/blog/general/running-mastodon-in-docker-compose.html#self_hosting
* https://peterbabic.dev/blog/running-mastodon-with-docker-compose/

```bash
docker-compose run --rm web bundle exec rake mastodon:setup DISABLE_DATABASE_ENVIRONMENT_CHECK=1
```

{{< figure2 src="images/mastodon-mailcatcher.webp" class="mastodon-mailcatcher" caption="Mastodon test email" attrrel="noopener noreferrer" >}}


Your instance is identified by its domain name. Changing it afterward will break things.
Domain name: social.localhost

Single user mode disables registrations and redirects the landing page to your public profile.
Do you want to enable single user mode? yes

Are you using Docker to run Mastodon? Yes

PostgreSQL host: db
PostgreSQL port: 5432
Name of PostgreSQL database: mastodon
Name of PostgreSQL user: postgres
Password of PostgreSQL user: 
Database configuration works! 🎆

Redis host: redis
Redis port: 6379
Redis password: 
Redis configuration works! 🎆

Do you want to store uploaded files on the cloud? No

Do you want to send e-mails from localhost? No
SMTP server: mailcatcher
SMTP port: 1025
SMTP username: mail@social.localhost
SMTP password: 
SMTP authentication: plain
SMTP OpenSSL verify mode: none
Enable STARTTLS: auto
E-mail address to send e-mails "from": Mastodon <notifications@social.localhost>
Send a test e-mail with this configuration right now? Yes
Send test e-mail to: mail@social.localhost
E-mail could not be sent with this configuration, try again.
SMTP-AUTH requested but missing secret phrase
Try again? Yes
Do you want to send e-mails from localhost? No
SMTP server: mailcatcher
SMTP port: 1025
SMTP username: 
SMTP password: 
SMTP authentication: plain
SMTP OpenSSL verify mode: none
Enable STARTTLS: auto
E-mail address to send e-mails "from": Mastodon <notifications@social.localhost>
Send a test e-mail with this configuration right now? Yes
Send test e-mail to: mail@social.localhost

This configuration will be written to .env.production
Save configuration? Yes

Database 'mastodon' already exists
Done!

All done! You can now power on the Mastodon server 🐘

Created database 'mastodon'
Done!

All done! You can now power on the Mastodon server 🐘

Do you want to create an admin user straight away? Yes
Username: admin
E-mail: admin@social.localhost
You can login with the password: eed2964695cc2ba4a0a1bb781ee1d0b3
You can change your password once you login. 
