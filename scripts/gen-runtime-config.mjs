#!/usr/bin/env node
/**
 * 根据环境变量生成 dist/runtime-config.js。
 *
 * 静态托管（如 GitHub Pages）无法运行浏览量服务，需要通过 API_BASE_URL 指向部署在别处的
 * 浏览量服务地址；留空时前端按同源请求 /api。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'dist/runtime-config.js')
const urlFile = join(root, 'deploy/api-base-url.txt')

const read = (name, fallback = '') => (process.env[name] ?? fallback).trim()

function fileApiBaseUrl() {
  if (!existsSync(urlFile)) return ''
  const text = readFileSync(urlFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'))
  return text ? text.replace(/\/$/, '') : ''
}

const config = {
  appTitle: read('APP_TITLE', 'Cesium酱の百宝箱'),
  apiBaseUrl: (read('API_BASE_URL') || fileApiBaseUrl()).replace(/\/$/, ''),
  cesiumIonToken: read('CESIUM_ION_TOKEN'),
  whiteModelTilesetBase: read('WHITE_MODEL_TILESET_BASE')
}

mkdirSync(dirname(target), { recursive: true })
writeFileSync(
  target,
  `window.__CESIUM_STUDIO_CONFIG__ = Object.assign(\n  ${JSON.stringify(config, null, 2).replace(/\n/g, '\n  ')},\n  window.__CESIUM_STUDIO_CONFIG__ || {}\n)\n`,
  'utf8'
)
console.log(`[runtime-config] apiBaseUrl=${config.apiBaseUrl || '(同源)'} -> ${target}`)
