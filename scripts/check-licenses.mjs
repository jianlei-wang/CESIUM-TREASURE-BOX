import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const licenses = new Map()

function fromPackageJson(path) {
  const file = join(root, path, 'package.json')
  if (!existsSync(file)) return ''
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof pkg.license === 'string') return pkg.license
    if (Array.isArray(pkg.licenses)) {
      return pkg.licenses
        .map((item) => (typeof item === 'string' ? item : item?.type))
        .filter(Boolean)
        .join(' OR ')
    }
  } catch {
    /* fall through to LICENSE sniffing */
  }
  return ''
}

function fromLicenseFile(path) {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']) {
    const file = join(root, path, name)
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8').slice(0, 4000)
    if (/Apache License/i.test(text)) return 'Apache-2.0'
    if (/BSD 3-Clause/i.test(text)) return 'BSD-3-Clause'
    if (/BSD 2-Clause/i.test(text)) return 'BSD-2-Clause'
    if (/WTFPL/i.test(text)) return 'WTFPL'
    if (/ISC License/i.test(text)) return 'ISC'
    if (/MIT License|Permission is hereby granted, free of charge/i.test(text)) return 'MIT'
  }
  return ''
}

function classify(license) {
  const text = String(license)
  const restricted = /(^|[^A-Z])(AGPL|LGPL|GPL|SSPL|EPL|MPL|CDDL|CPAL|OSL)/i.test(text)
  const permissive = /(MIT|ISC|BSD|APACHE|0BSD|CC0|UNLICENSE|BLUEOAK|ZLIB|WTFPL|EDL|PYTHON|CC-BY)/i.test(text)
  const alternative = /\bOR\b|\bor\b/i.test(text)
  if (!permissive) return 'unknown'
  if (restricted && !alternative) return 'restricted'
  return 'allowed'
}

const inferred = []
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path.startsWith('node_modules/')) continue
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
  let license = entry.license || ''
  if (!license) {
    license = fromPackageJson(path)
    if (!license) {
      license = fromLicenseFile(path)
      if (license) inferred.push(`${name} -> ${license}`)
    }
  }
  licenses.set(`${name}@${entry.version}`, license || 'MISSING')
}

const counts = new Map()
const violations = []
for (const [name, license] of licenses) {
  counts.set(license, (counts.get(license) ?? 0) + 1)
  const state = classify(license)
  if (state !== 'allowed') violations.push(`${name}: ${license} (${state})`)
}

console.log(`check-licenses: ${licenses.size} packages`)
for (const [license, count] of [...counts].sort((left, right) => right[1] - left[1])) {
  console.log(`  - ${license}: ${count}`)
}
if (inferred.length) {
  console.log('check-licenses: inferred from LICENSE files')
  for (const item of inferred) console.log(`  - ${item}`)
}
if (violations.length) {
  console.error('check-licenses: restricted or unknown licenses found')
  for (const item of violations) console.error(`  - ${item}`)
  process.exit(1)
}
console.log('check-licenses: all dependency licenses are permissively licensed or dual-licensed')
