FROM node:20.3-alpine

# Create temp dir
RUN mkdir /app

# Set working directory
WORKDIR /app

CMD ["node", "dist/watcher.js"]
