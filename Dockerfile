FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:20-alpine

RUN apk add --no-cache tzdata curl

WORKDIR /app
RUN addgroup -S hornet && adduser -S hornet -G hornet

COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Build admin panel
WORKDIR /app/admin-panel
RUN npm ci && npm run build

WORKDIR /app
RUN rm -rf public/admin && mkdir -p public/admin && cp -r admin-panel/dist/* public/admin/

RUN chown -R hornet:hornet /app

USER hornet

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fs http://localhost:3000/health || exit 1

CMD ["sh", "-c", "node src/server.js"]
