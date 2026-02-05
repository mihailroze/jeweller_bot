FROM node:20-alpine

WORKDIR /app

COPY package.json server.js ./
COPY public ./public

RUN mkdir -p /app/data

CMD ["node", "server.js"]
