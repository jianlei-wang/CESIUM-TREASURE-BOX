import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = process.cwd()
const dist = join(root, 'dist')
// entryGzip 预算随案例清单线性增长：manifest.ts 把全部案例的标题与描述内联进首屏包，
// 每新增一个案例约 +0.2 kB gzip。预留在 160 kB 以容纳案例数量继续增长。
const budget = {
  entryJs: 400 * 1024,
  entryGzip: 160 * 1024,
  initialCss: 120 * 1024,
  chunkJs: 800 * 1024,
  chunkGzip: 250 * 1024
}

if (!existsSync(dist)) {
  console.error('check-bundle: dist/ is missing, run npm run build first')
  process.exit(1)
}

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const initial = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1])
const entryJs = initial.filter((file) => file.endsWith('.js'))
const initialCss = initial.filter((file) => file.endsWith('.css'))
const assets = readdirSync(join(dist, 'assets'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => {
    const buffer = readFileSync(join(dist, 'assets', file))
    return { file, size: buffer.length, gzip: gzipSync(buffer).length }
  })

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
const failures = []
if (!entryJs.length) failures.push('no module entry script found in dist/index.html')

for (const file of entryJs) {
  const buffer = readFileSync(join(dist, file))
  if (buffer.length > budget.entryJs)
    failures.push(`entry ${file} is ${kb(buffer.length)} (budget ${kb(budget.entryJs)})`)
  const gzip = gzipSync(buffer).length
  if (gzip > budget.entryGzip) failures.push(`entry ${file} gzip is ${kb(gzip)} (budget ${kb(budget.entryGzip)})`)
}
for (const file of initialCss) {
  const buffer = readFileSync(join(dist, file))
  if (buffer.length > budget.initialCss) failures.push(`initial css ${file} is ${kb(buffer.length)}`)
}

const lazy = assets.filter((asset) => !entryJs.includes(`assets/${asset.file}`))
for (const asset of lazy) {
  if (asset.size > budget.chunkJs)
    failures.push(`chunk ${asset.file} is ${kb(asset.size)} (budget ${kb(budget.chunkJs)})`)
  if (asset.gzip > budget.chunkGzip) failures.push(`chunk ${asset.file} gzip is ${kb(asset.gzip)}`)
}

// vite-plugin-cesium 把 `cesium` 声明为外部依赖并通过 rollup-plugin-external-globals
// 改写成全局 window.Cesium。星号重导出（export * from 'cesium'）无法被该插件改写，
// 会在 chunk 中留下裸 `from "cesium"`，浏览器 ESM 解析失败导致案例白屏。
const bareCesium = [...entryJs, ...lazy.map((asset) => `assets/${asset.file}`)].filter((file) =>
  /from\s*["']cesium["']/.test(readFileSync(join(dist, file), 'utf8'))
)
if (bareCesium.length) {
  failures.push(`bare "cesium" import found in ${bareCesium.length} chunk(s): ${bareCesium.slice(0, 5).join(', ')}`)
}

// 产物 base 是 `./`，GitHub Pages 部署在仓库子路径下。代码里若直接写 `/images/...`
// 这类根路径绝对地址，线上会解析到域名根目录而 404。这里扫描源码，确保 public 资源
// 绝对路径都经过 assetUrl() 处理。
const publicDirs = [
  'admin',
  'cesium',
  'data',
  'dayanta',
  'draco',
  'geo',
  'helpers',
  'images',
  'models',
  'vendor',
  'videos'
]
const rootAssetPattern = new RegExp(`["'\`]/(?:${publicDirs.join('|')})/`)
const allowlistedPublicPaths = new Set([
  'src/lib/asset-url.ts',
  'src/components/PerfChecklistDoc.vue',
  'src/cases/low-altitude-planning/roadmap.html'
])
const rootAssetViolations = []
const walkSource = (dir) => {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      walkSource(file)
      continue
    }
    if (!/\.(?:ts|tsx|vue|js|mjs)$/.test(entry.name) || allowlistedPublicPaths.has(file)) continue
    const lines = readFileSync(join(root, file), 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (rootAssetPattern.test(line) && !line.includes('assetUrl(')) {
        rootAssetViolations.push(`${file}:${index + 1}`)
      }
    })
  }
}
walkSource('src')
if (rootAssetViolations.length) {
  failures.push(
    `root-absolute public asset path found (wrap with assetUrl()): ${rootAssetViolations.slice(0, 5).join(', ')}`
  )
}

const initialTotal = initial.reduce((total, file) => total + readFileSync(join(dist, file)).length, 0)
console.log(`check-bundle: ${assets.length} JS chunks, initial payload ${kb(initialTotal)}`)
for (const file of entryJs) {
  const buffer = readFileSync(join(dist, file))
  console.log(`  entry ${file}: ${kb(buffer.length)} / gzip ${kb(gzipSync(buffer).length)}`)
}
for (const asset of lazy.sort((left, right) => right.size - left.size).slice(0, 5)) {
  console.log(`  chunk ${asset.file}: ${kb(asset.size)} / gzip ${kb(asset.gzip)}`)
}
if (failures.length) {
  console.error('check-bundle: budget exceeded')
  for (const item of failures) console.error(`  - ${item}`)
  process.exit(1)
}
console.log('check-bundle: all bundles are within budget')
