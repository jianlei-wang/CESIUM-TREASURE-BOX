import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const source = join(process.cwd(), 'node_modules/@dimforge/rapier3d-compat/rapier.es.js')
const target = join(process.cwd(), 'public/vendor/rapier/rapier.es.js')

if (!existsSync(source)) {
  console.warn('copy-rapier: @dimforge/rapier3d-compat is not installed, physics falls back to the analytic backend')
  process.exit(0)
}

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log(`copy-rapier: ${target}`)
