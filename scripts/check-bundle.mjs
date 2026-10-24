import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = process.cwd()
const dist = join(root, 'dist')
const budget = {
  entryJs: 400 * 1024,
  entryGzip: 150 * 1024,
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
