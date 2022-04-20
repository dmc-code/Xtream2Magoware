FROM node:15.8.0-alpine

WORKDIR /app

# Install yarn and other dependencies via apk
RUN apk update && apk add openssl bash git python g++ make && rm -rf /var/cache/apk/*

# Install node dependencies - done in a separate step so Docker can cache it.
COPY ./package.json /app/
COPY ./package-lock.json /app/
RUN npm install

## Copy project files into the docker image
COPY ./src /app/src
COPY ./cli.js /app/cli.js
COPY ./scripts/startup.sh /usr/local/startup.sh

RUN /usr/local/startup.sh

CMD ["/bin/sh"]
