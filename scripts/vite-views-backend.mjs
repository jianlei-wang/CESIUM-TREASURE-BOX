/**
 * 让 Vite 开发/预览进程直接复用线上浏览量数据源。
 *
 * 以 GitHub Pages 为准：`deploy/api-base-url.txt`（或 VIEWS_API_BASE_URL）指向部署在
 * Cloudflare Workers 上的浏览量服务，预览环境的 `/api` 也代理到同一个服务，避免本地
 * 与线上各记一套数据。
 *
 * 没有配置线上地址时回退到本地 8787 后端，并在本进程内拉起，方便离线开发。
 *
 * 注意：部分沙箱 DNS 会把 *.workers.dev 解析到错误地址，因此解析优先走 DoH，
 * 并对候选 IP 做 TCP 连通性探测，选中可用地址后由自定义 lookup 固定使用。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { connect, isIP } from 'node:net'
import https from 'node:https'

const DEFAULT_PORT = 8787
const HOST = '127.0.0.1'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API_BASE_FILE = resolve(ROOT, 'deploy/api-base-url.txt')
const SERVER_ENTRY = resolve(ROOT, 'server/index.mjs')
const IP_TTL = 5 * 60 * 1000

function remoteBase() {
  const fromEnv = process.env.VIEWS_API_BASE_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  if (!existsSync(API_BASE_FILE)) return ''
  const line = readFileSync(API_BASE_FILE, 'utf8')
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('#'))
  return line ? line.replace(/\/$/, '') : ''
}

async function resolveViaDoh(hostname) {
  const endpoints = ['https://1.1.1.1/dns-query', 'https://cloudflare-dns.com/dns-query']
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}?name=${encodeURIComponent(hostname)}&type=A`, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(4000)
      })
      if (!response.ok) continue
      const data = await response.json()
      const ips = (data.Answer ?? []).filter((item) => item.type === 1).map((item) => item.data)
      if (ips.length) return ips
    } catch {
      // 换下一个 DoH 端点
    }
  }
  return []
}

function probe(ip, port) {
  return new Promise((resolveProbe) => {
    const socket = connect({ host: ip, port, timeout: 2500 })
    socket.once('connect', () => {
      socket.destroy()
      resolveProbe(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolveProbe(false)
    })
    socket.once('error', () => resolveProbe(false))
  })
}

function createPinnedResolver(hostname, port) {
  let cachedIp = ''
  let expiresAt = 0
  let pending

  async function refresh() {
    const candidates = await resolveViaDoh(hostname)
    for (const ip of candidates) {
      if (await probe(ip, port)) return ip
    }
    return ''
  }

  function resolve() {
    if (cachedIp && Date.now() < expiresAt) return Promise.resolve(cachedIp)
    if (!pending) {
      pending = refresh()
        .then((ip) => {
          cachedIp = ip
          expiresAt = ip ? Date.now() + IP_TTL : 0
          return ip
        })
        .finally(() => {
          pending = undefined
        })
    }
    return pending
  }

  return {
    invalidate() {
      cachedIp = ''
      expiresAt = 0
    },
    lookup(host, options, callback) {
      const literal = isIP(host)
      if (literal) {
        if (options?.all) return callback(null, [{ address: host, family: literal }])
        return callback(null, host, literal)
      }
      resolve()
        .then((ip) => {
          if (!ip) return callback(new Error(`无法解析 ${host}`))
          if (options?.all) return callback(null, [{ address: ip, family: isIP(ip) }])
          callback(null, ip, isIP(ip))
        })
        .catch((error) => callback(error))
    }
  }
}

function remoteProxyOptions(target) {
  const url = new URL(target)
  const secure = url.protocol === 'https:'
  const port = Number(url.port) || (secure ? 443 : 80)
  const resolver = createPinnedResolver(url.hostname, port)
  const options = {
    target,
    changeOrigin: true,
    secure,
    agent: secure ? new https.Agent({ keepAlive: true, lookup: resolver.lookup.bind(resolver) }) : undefined
  }
  options.configure = (proxy) => {
    proxy.on('error', (error) => {
      const message = error?.message ?? ''
      if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up/i.test(message)) {
        resolver.invalidate()
      }
    })
  }
  return options
}

let proxyCache

export function viewsRemoteBase() {
  return remoteBase()
}

export function viewsProxyOptions() {
  const remote = remoteBase()
  if (!remote) {
    return { target: `http://${HOST}:${DEFAULT_PORT}`, changeOrigin: true }
  }
  proxyCache ??= remoteProxyOptions(remote)
  return proxyCache
}

function localBackend() {
  const target = `http://${HOST}:${DEFAULT_PORT}`
  let startPromise
  let handle

  async function start() {
    if (startPromise) return startPromise
    startPromise = (async () => {
      try {
        const response = await fetch(`${target}/api/health`, { signal: AbortSignal.timeout(800) })
        if (response.ok) {
          console.log(`[views] 复用已运行的本地浏览量服务：${target}`)
          return
        }
      } catch {
        // 未运行则自行拉起
      }

      try {
        const serverModule = await import(pathToFileURL(SERVER_ENTRY).href)
        const created = await serverModule.createViewServer()
        await new Promise((resolveListen, rejectListen) => {
          created.server.once('error', rejectListen)
          created.server.listen(DEFAULT_PORT, HOST, () => {
            created.server.off('error', rejectListen)
            resolveListen()
          })
        })
        handle = created
        console.log(`[views] 未配置线上数据源，已启动本地浏览量服务：${target}`)
      } catch (error) {
        console.warn(`[views] 浏览量服务启动失败，/api 接口不可用：${error?.message ?? error}`)
      }
    })()
    return startPromise
  }

  async function stop() {
    if (!handle) return
    const { server, store } = handle
    handle = undefined
    await new Promise((resolveClose) => server.close(() => resolveClose()))
    try {
      await store.flush()
    } catch (error) {
      console.warn('[views] 退出前保存失败：', error?.message ?? error)
    }
  }

  return { target, start, stop }
}

export function viewsBackend() {
  const remote = remoteBase()
  const backend = remote ? null : localBackend()

  const attachShutdown = (httpServer) => {
    if (!backend) return
    httpServer?.once('close', () => {
      void backend.stop()
    })
  }

  return {
    name: 'views-backend',
    apply: 'serve',
    async configureServer(server) {
      if (remote) {
        console.log(`[views] /api 代理到线上数据源：${remote}`)
      } else {
        await backend.start()
      }
      attachShutdown(server.httpServer)
    },
    async configurePreviewServer(server) {
      if (remote) {
        console.log(`[views] /api 代理到线上数据源：${remote}`)
      } else {
        await backend.start()
      }
      attachShutdown(server.httpServer)
    }
  }
}
