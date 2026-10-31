# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
ARG BASE_URL=/
ENV BASE_URL=${BASE_URL}
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80
ENV HOST=0.0.0.0
ENV STATIC_ROOT=/app/dist
ENV VIEWS_DATA_FILE=/app/data/case-views.json
ENV VIEW_RETENTION_DAYS=90
ENV APP_TITLE="Cesium酱の百宝箱"
ENV API_BASE_URL=""
ENV CESIUM_ION_TOKEN=""
ENV WHITE_MODEL_TILESET_BASE=""
COPY server ./server
COPY docker/entrypoint.sh /usr/local/bin/studio-entrypoint.sh
RUN chmod +x /usr/local/bin/studio-entrypoint.sh
COPY --from=build /app/dist ./dist
COPY --from=build /app/public/data/cases.json ./dist/data/cases.json
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/studio-entrypoint.sh"]
