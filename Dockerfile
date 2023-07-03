FROM node:20.3-alpine

RUN mkdir -p /app

WORKDIR /app

COPY . /app

CMD ["node", "/app/dist/watcher.js"]
