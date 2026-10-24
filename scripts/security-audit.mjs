import { spawnSync } from 'node:child_process'

const ALLOWED = {
  xlsx: {
    advisories: ['GHSA-4r6h-8v6p-xvw6', 'GHSA-5pgg-2g8v-p4x9'],
    reason: 'SheetJS 0.18.5 has no npm fix; the workbook reader runs on user-selected local files only'
  }
}

const result = spawnSync('npm', ['audit', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 120_000,
  maxBuffer: 32 * 1024 * 1024
})
const output = result.stdout?.trim()
if (!output) {
  console.error('security-audit: npm audit returned no data')
  console.error(result.stderr || result.error?.message || 'unknown error')
  process.exit(1)
}

let report
try {
  report = JSON.parse(output)
} catch {
  console.error('security-audit: cannot parse npm audit output')
  process.exit(1)
}

const failures = []
const allowed = []
const remaining = []
for (const [name, info] of Object.entries(report.vulnerabilities ?? {})) {
  const severity = info.severity ?? 'unknown'
  if (!['high', 'critical'].includes(severity)) {
    remaining.push(`${name} (${severity})`)
    continue
  }
  const advisories = (info.via ?? [])
    .filter((item) => typeof item === 'object')
    .map((item) =>
      String(item.url ?? '')
        .split('/')
        .pop()
    )
    .filter(Boolean)
  const exception = ALLOWED[name]
  const covered = exception && advisories.every((id) => exception.advisories.includes(id))
  if (covered && info.fixAvailable !== true) {
    allowed.push(`${name} (${severity}): ${exception.reason}`)
    continue
  }
  failures.push(`${name} (${severity}): ${advisories.join(', ') || 'transitive advisory'}`)
}

if (allowed.length) {
  console.log('security-audit: accepted exceptions')
  for (const item of allowed) console.log(`  - ${item}`)
}
if (remaining.length) {
  console.log(`security-audit: below gate -> ${remaining.join(', ')}`)
}
if (failures.length) {
  console.error('security-audit: high or critical vulnerabilities require action')
  for (const item of failures) console.error(`  - ${item}`)
  process.exit(1)
}
console.log('security-audit: no unapproved high or critical vulnerabilities')
