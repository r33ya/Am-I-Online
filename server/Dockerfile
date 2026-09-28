FROM node:20-alpine

WORKDIR /app

COPY server/package.json ./package.json
COPY server/server.js ./server.js
COPY web ./web

ENV NODE_ENV=production \
    PORT=8787 \
    WEB_DIR=/app/web \
    DATA_FILE=/app/data/status.json

RUN mkdir -p /app/data
EXPOSE 8787

CMD ["node", "server.js"]
