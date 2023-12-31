FROM node:latest

# Create app directory
RUN mkdir -p /app
WORKDIR /app
COPY . /app

# Install app dependencies and build
RUN yarn
RUN yarn run build

# Smoke test
RUN node /app/dist/test.js

EXPOSE 3000

CMD ["node", "/app/dist/watcher.js"]
