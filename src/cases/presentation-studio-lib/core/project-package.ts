import JSZip from 'jszip'
import {
  parseProjectDocument,
  runtimeToDocument,
  type AssetManifestEntry,
  type ParsedProject,
  type StudioProject
} from './schema'
import type { PresentationProject } from './types'

export interface PackageAsset {
  entry: AssetManifestEntry
  blob: Blob
}

export interface PackResult {
  blob: Blob
  document: StudioProject
  assetCount: number
  warnings: string[]
}

export interface UnpackResult {
  parsed: ParsedProject
  missingAssets: string[]
  checksumFailures: string[]
  warnings: string[]
  assets: Record<string, Blob>
}

async function sha256(blob: Blob): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return ''
  const buffer = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function safePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized.includes('..') || normalized.startsWith('/')) throw new Error(`资源路径不合法：${path}`)
  return normalized
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'presentation'
}

export async function packStudioPackage(
  project: PresentationProject,
  assets: PackageAsset[] = []
): Promise<PackResult> {
  const document = runtimeToDocument(project)
  const warnings: string[] = []
  const zip = new JSZip()
  const assetsFolder = zip.folder('assets')
  if (!assetsFolder) throw new Error('无法创建资源目录')
  const manifestAssets: AssetManifestEntry[] = []
  const packagedUris = new Map<string, string>()
  for (const asset of assets) {
    const path = safePath(asset.entry.uri)
    const hash = await sha256(asset.blob)
    if (!hash) warnings.push('当前环境不支持 SHA-256，资源校验信息缺失')
    const entry: AssetManifestEntry = {
      ...asset.entry,
      uri: `assets/${path}`,
      hash: hash || asset.entry.hash,
      bytes: asset.blob.size
    }
    manifestAssets.push(entry)
    packagedUris.set(entry.id, entry.uri)
    assetsFolder.file(path, await asset.blob.arrayBuffer())
  }
  const referenced = new Set(manifestAssets.map((item) => item.id))
  for (const entry of document.assets) {
    if (!referenced.has(entry.id)) {
      manifestAssets.push(entry)
      if (entry.required) warnings.push(`必需资源 ${entry.name} 未包含在工程包内`)
    }
  }
  const scenes = document.scenes.map((scene) => ({
    ...scene,
    customLayers: scene.customLayers?.map((layer) => {
      const uri = packagedUris.get(`asset_${layer.id}`)
      return uri ? { ...layer, uri } : layer
    })
  }))
  const packaged: StudioProject = { ...document, scenes, assets: manifestAssets }
  zip.file('project.json', JSON.stringify(packaged, null, 2))
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        format: 'cesium.studio.package',
        version: 2,
        createdAt: new Date().toISOString(),
        projectId: packaged.id,
        title: packaged.metadata.title,
        assets: manifestAssets.map((entry) => ({
          id: entry.id,
          name: entry.name,
          kind: entry.kind,
          uri: entry.uri,
          hash: entry.hash ?? null,
          bytes: entry.bytes ?? null,
          required: entry.required,
          license: entry.license ?? null
        }))
      },
      null,
      2
    )
  )
  zip.file(
    'README.txt',
    `CESIUM PRESENTATION STUDIO 工程包\n\n工程：${packaged.metadata.title}\n导出时间：${new Date().toISOString()}\n\n目录：\n- project.json：统一 v2 工程文档\n- manifest.json：资源清单、SHA-256 与版权信息\n- assets/：工程资源（相对路径引用）\n`
  )
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return { blob, document: packaged, assetCount: manifestAssets.length, warnings }
}

export async function unpackStudioPackage(file: Blob): Promise<UnpackResult> {
  const zip = await JSZip.loadAsync(file)
  const projectFile = zip.file('project.json') ?? zip.file(/project\.json$/)[0]
  if (!projectFile) throw new Error('工程包缺少 project.json')
  const raw = await projectFile.async('string')
  let parsedRaw: unknown
  try {
    parsedRaw = JSON.parse(raw)
  } catch {
    throw new Error('project.json 不是有效的 JSON')
  }
  let manifest: { assets?: AssetManifestEntry[] } = {}
  const manifestFile = zip.file('manifest.json')
  if (manifestFile) {
    try {
      manifest = JSON.parse(await manifestFile.async('string')) as { assets?: AssetManifestEntry[] }
    } catch {
      manifest = {}
    }
  }
  const missingAssets: string[] = []
  const checksumFailures: string[] = []
  const warnings: string[] = []
  const assets: Record<string, Blob> = {}
  for (const entry of manifest.assets ?? []) {
    const assetFile = zip.file(entry.uri)
    if (!assetFile) {
      if (entry.required) missingAssets.push(entry.name)
      else warnings.push(`缺少可选资源：${entry.name}`)
      continue
    }
    const blob = await assetFile.async('blob')
    assets[entry.uri] = blob
    if (entry.hash) {
      const actual = await sha256(blob)
      if (actual && actual !== entry.hash) checksumFailures.push(entry.name)
    }
  }
  for (const entry of parsedRaw && typeof parsedRaw === 'object' && Array.isArray((parsedRaw as StudioProject).assets)
    ? (parsedRaw as StudioProject).assets
    : []) {
    if (!entry.uri.startsWith('studio://') && !zip.file(entry.uri) && entry.required) {
      if (!missingAssets.includes(entry.name)) missingAssets.push(entry.name)
    }
  }
  const parsed = parseProjectDocument(parsedRaw)
  return { parsed, missingAssets, checksumFailures, warnings, assets }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function playerHtml(title: string, playerBase: string): string {
  const base = playerBase.endsWith('/') ? playerBase : `${playerBase}/`
  const payload = JSON.stringify({ base, title }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · 只读播放</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #06101c; color: #dbe9f5; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 560px; padding: 32px; text-align: center; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
  p { margin: 0 0 18px; color: #8aa4b8; font-size: 13px; line-height: 1.7; }
  a { color: #59c7e8; }
</style>
</head>
<body>
<main>
  <h1 id="title">正在启动只读播放器</h1>
  <p id="status">正在定位工程文件…</p>
  <p id="hint"></p>
</main>
<script>
(function () {
  var config = ${payload};
  var status = document.getElementById('status');
  var hint = document.getElementById('hint');
  var projectUrl = new URL('./project.json', location.href);
  var assetBase = new URL('./', location.href);
  try {
    if (location.protocol === 'file:') throw new Error('请通过 HTTP 服务器访问该目录，file:// 协议无法加载工程资源');
    var target = new URL('index.html', config.base);
    target.searchParams.set('player', '1');
    target.searchParams.set('project', projectUrl.href);
    target.searchParams.set('assetBase', assetBase.href);
    status.textContent = '正在跳转到播放器…';
    location.replace(target.href);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    hint.innerHTML = '也可将工程目录部署到任意静态服务器后，使用 <a href="' + projectUrl.href + '">project.json</a> 加载。';
  }
})();
</script>
</body>
</html>
`
}

export async function packPlayerPackage(
  project: PresentationProject,
  playerBase: string,
  assets: PackageAsset[] = []
): Promise<PackResult> {
  const packed = await packStudioPackage(project, assets)
  const zip = await JSZip.loadAsync(await packed.blob.arrayBuffer())
  zip.file('player.html', playerHtml(packed.document.metadata.title, playerBase))
  zip.file(
    'PLAYER.txt',
    `只读播放

1. 将本目录部署到静态服务器（必须通过 HTTP 访问）
2. 打开 player.html 即可加载 project.json 与 assets/
3. 播放器基地址：${playerBase}

如需更换载体，可手工访问 ${playerBase}?player=1&project=<project.json 的 URL>&assetBase=<assets/ 的 URL>
`
  )
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return { ...packed, blob }
}

export function packageFileName(project: PresentationProject): string {
  return `${safeFileName(project.name)}.studio.zip`
}
