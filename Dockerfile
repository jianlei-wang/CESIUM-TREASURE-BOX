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

FROM nginx:1.27-alpine AS runtime
ENV APP_TITLE="Cesium酱の百宝箱"
ENV API_BASE_URL=""
ENV CESIUM_ION_TOKEN=""
ENV WHITE_MODEL_TILESET_BASE=""
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /docker-entrypoint.d/40-studio-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-studio-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
