#!/usr/bin/env node
/**
 * 一体化开发启动脚本：同时启动浏览量服务（Node）与 Vite 开发服务器。
 * Vite 通过 /api 反向代理访问浏览量服务，前端只需暴露 5173 端口。
 *
 * 额外参数会透传给 Vite，例如：
 *   npm run dev -- --host 0.0.0.0 --port 5173
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const viteArgs = process.argv.slice(2)
const backendPort = process.env.PORT || '8787'
const backendUrl = `http://127.0.0.1:${backendPort}`

const children = []
let shuttingDown = false

function start(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  children.push(child)

  const prefix = `[${name}] `
  const forward = (stream, target) => {
    let buffer = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) target.write(`${prefix}${line}\n`)
    })
  }
  forward(child.stdout, process.stdout)
  forward(child.stderr, process.stderr)

  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.log(`${prefix}进程退出（code=${code ?? 'null'} signal=${signal ?? 'none'}）`)
    if (name === 'views') console.log('[dev] 浏览量服务已退出，开发服务器将一并停止')
    shutdown(code ?? 1)
  })
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGKILL')
    }
    process.exit(code)
  }, 3000).unref()
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

async function backendRunning() {
  try {
    const response = await fetch(`${backendUrl}/api/health`, { signal: AbortSignal.timeout(1200) })
    return response.ok
  } catch {
    return false
  }
}

async function main() {
  if (await backendRunning()) {
    console.log(`[dev] 检测到 ${backendUrl} 已有浏览量服务，直接复用`)
  } else {
    start('views', process.execPath, [join(root, 'server/index.mjs')], { PORT: backendPort })
  }
  start('vite', process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), ...viteArgs], {
    VIEWS_PROXY_TARGET: backendUrl
  })
}

void main()
