FROM node:20.3-alpine

# Create temp dir
RUN mkdir /app

# Set working directory
WORKDIR /app

# Copy source to web directory
COPY ./dist /app

CMD ["node", "app/watcher.js"]
