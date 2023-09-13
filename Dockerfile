FROM node:latest

RUN mkdir -p /app

WORKDIR /app

COPY . /app

CMD ["node", "/app/dist/watcher.js"]
