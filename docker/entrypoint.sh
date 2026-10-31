#!/bin/sh
set -eu

STATIC_ROOT="${STATIC_ROOT:-/app/dist}"

cat > "${STATIC_ROOT}/runtime-config.js" <<CONFIG
window.__CESIUM_STUDIO_CONFIG__ = {
  appTitle: "${APP_TITLE}",
  apiBaseUrl: "${API_BASE_URL}",
  cesiumIonToken: "${CESIUM_ION_TOKEN}",
  whiteModelTilesetBase: "${WHITE_MODEL_TILESET_BASE}"
}
CONFIG

if [ -n "${ADMIN_TOKEN:-}" ]; then
  echo "[studio] 使用 ADMIN_TOKEN 环境变量作为后台口令"
fi

mkdir -p "$(dirname "${VIEWS_DATA_FILE:-/app/data/case-views.json}")"

exec node /app/server/index.mjs
