import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const failures = []
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lockfilePath = join(root, 'package-lock.json')

const competing = ['yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'].filter((name) => existsSync(join(root, name)))
if (competing.length) failures.push(`competing lockfiles: ${competing.join(', ')}`)
if (!existsSync(lockfilePath)) failures.push('package-lock.json is missing')

let lock = {}
if (existsSync(lockfilePath)) {
  try {
    lock = JSON.parse(readFileSync(lockfilePath, 'utf8'))
  } catch {
    failures.push('package-lock.json is not valid JSON')
  }
}

const version = Number(lock.lockfileVersion ?? 0)
if (version < 2) failures.push(`lockfileVersion ${version || 'missing'} requires npm 7+`)

const rootEntry = lock.packages?.[''] ?? {}
const names = ['name', 'version']
for (const key of names) {
  if (rootEntry[key] !== packageJson[key]) {
    failures.push(`root ${key} mismatch: package.json=${packageJson[key]} lock=${rootEntry[key]}`)
  }
}

for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  const manifest = packageJson[section] ?? {}
  const locked = rootEntry[section] ?? {}
  for (const [name, spec] of Object.entries(manifest)) {
    if (locked[name] !== spec)
      failures.push(`${section}.${name} spec mismatch: package.json=${spec} lock=${locked[name] ?? 'missing'}`)
    if (!lock.packages?.[`node_modules/${name}`]) failures.push(`${section}.${name} has no resolved package entry`)
  }
  for (const name of Object.keys(locked)) {
    if (!(name in manifest)) failures.push(`${section}.${name} exists in lockfile but not package.json`)
  }
}

const entries = Object.entries(lock.packages ?? {}).filter(([path]) => path.startsWith('node_modules/'))
let missingIntegrity = 0
for (const [path, entry] of entries) {
  if (entry.link) continue
  if (!entry.resolved) failures.push(`${path} has no resolved URL`)
  if (!entry.integrity) missingIntegrity += 1
}
if (missingIntegrity) failures.push(`${missingIntegrity} packages have no integrity hash`)

if (existsSync(join(root, 'node_modules'))) {
  const tree = spawnSync('npm', ['ls', '--all', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024
  })
  try {
    const parsed = JSON.parse(tree.stdout || '{}')
    for (const problem of parsed.problems ?? []) failures.push(`npm tree: ${problem}`)
  } catch {
    failures.push('npm ls output could not be parsed')
  }
}

const ignored = ['.git', 'node_modules', 'dist']
const nestedLocks = []
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || ignored.includes(entry.name)) continue
  if (readdirSync(join(root, entry.name)).includes('package-lock.json')) nestedLocks.push(entry.name)
}
if (nestedLocks.length) console.log(`check-lockfile: nested lockfiles present in ${nestedLocks.join(', ')}`)

if (failures.length) {
  console.error('check-lockfile: validation failed')
  for (const item of failures) console.error(`  - ${item}`)
  process.exit(1)
}
console.log(`check-lockfile: lockfileVersion ${version}, ${entries.length} packages, integrity hashes present`)
