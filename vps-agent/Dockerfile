FROM node:20-alpine

RUN apk add --no-cache curl docker-cli git bash

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/

EXPOSE 7847

HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://127.0.0.1:7847/health || exit 1

CMD ["node", "dist/vps-agent/src/index.js"]
