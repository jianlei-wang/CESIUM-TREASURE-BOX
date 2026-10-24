#!/bin/sh
set -eu
cat > /usr/share/nginx/html/runtime-config.js <<CONFIG
window.__CESIUM_STUDIO_CONFIG__ = {
  appTitle: "${APP_TITLE}",
  apiBaseUrl: "${API_BASE_URL}",
  cesiumIonToken: "${CESIUM_ION_TOKEN}"
}
CONFIG
