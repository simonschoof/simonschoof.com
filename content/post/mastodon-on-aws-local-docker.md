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
This post is the first part of a two article series on deploying and running a Mastodon instance on AWS. 
The code for this part can be found [here](https://github.com/simonschoof/mastodon-aws).

{{< series "Running Mastodon on AWS" >}} 

### Introduction

Motivation here: Testing, playing around and make my self familiar with Mastodon and its configuration.

### Adapting to run locally

#### Remove networks

Remove the internal and external networks from the docker-compose file as there is no need to distinguish between internal and external networks when running locally.

#### Create local certificate

```bash
openssl req -x509 -out social.localhost.crt -keyout social.localhost.key \
  -newkey rsa:2048 -nodes -sha256 \
  -subj '/CN=social.localhost' -extensions EXT -config <( \
   printf "[dn]\nCN=social.localhost\n[req]\ndistinguished_name = dn\n[EXT]\nsubjectAltName=DNS:social.localhost\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth")
```

and add them to the nginx web server configuration:

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

#### Add Mailcatcher

```yaml
mailcatcher:
  restart: always
  image: schickling/mailcatcher
  container_name: mastodon-mailcatcher
  ports:
    - 1025:1025
    - 1080:1080
```

#### Add Minio

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
