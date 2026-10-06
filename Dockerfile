FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && npx playwright install --with-deps chromium
COPY . .
RUN npm test && DOC_STRICT_GIT=1 npm run build && npm run verify

FROM nginx:stable-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=10s --timeout=5s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1:8080/health.json || exit 1
EXPOSE 8080
