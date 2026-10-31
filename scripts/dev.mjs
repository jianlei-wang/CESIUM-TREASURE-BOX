#!/usr/bin/env node
/**
 * 一体化开发启动脚本。
 *
 * 默认以 GitHub Pages 的线上浏览量服务为准：`/api` 由 Vite 代理到
 * `deploy/api-base-url.txt`（或 VIEWS_API_BASE_URL）指向的 Cloudflare Worker，
 * 本地不再另起一套数据库。
 *
 * 未配置线上地址时回退到本地 8787 后端，由 Vite 插件自动拉起，因此通常无需再单独启后端。
 *
 * 额外参数会透传给 Vite，例如：
 *   npm run dev -- --host 0.0.0.0 --port 5173
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { viewsRemoteBase } from './vite-views-backend.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const viteArgs = process.argv.slice(2)
const remote = viewsRemoteBase()

let viteChild
let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  if (viteChild && !viteChild.killed) viteChild.kill('SIGTERM')
  setTimeout(() => {
    if (viteChild && !viteChild.killed) viteChild.kill('SIGKILL')
    process.exit(code)
  }, 3000).unref()
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

function main() {
  if (remote) {
    console.log(`[dev] 浏览量数据源：${remote}（与 GitHub Pages 一致）`)
  } else {
    console.log('[dev] 未配置线上数据源，将由 Vite 插件启动本地浏览量服务（8787）')
  }

  viteChild = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), ...viteArgs], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  })

  viteChild.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.log(`[dev] Vite 进程退出（code=${code ?? 'null'} signal=${signal ?? 'none'}）`)
    shutdown(code ?? 1)
  })
}

main()
