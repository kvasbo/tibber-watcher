FROM node:latest

# Create app directory
RUN mkdir -p /app
WORKDIR /app
COPY . /app

# Install app dependencies and build
RUN yarn
RUN yarn run build

EXPOSE 3000

CMD ["node", "/app/dist/watcher.js"]
