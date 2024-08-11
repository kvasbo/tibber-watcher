FROM node:20-alpine

# Create app directory
RUN mkdir -p /app
WORKDIR /app
COPY . /app

# Install app dependencies and build
RUN yarn install

EXPOSE 3000

CMD ["node", "/app/src/Watcher.mjs"]
