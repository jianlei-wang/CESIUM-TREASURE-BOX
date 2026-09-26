import { parseFrontmatter } from '../lib/markdown'

const RAW_FILES = {
  ...(import.meta.glob('./*/*.{md,js}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob('./*/*/*.{md,js}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)
}

export interface SkillFile {
  id: string
  name: string
  group: string
  title: string
  language: string
  markdown: boolean
  content: string
}

export interface Skill {
  id: string
  name: string
  description: string
  files: SkillFile[]
}

function toTitle(content: string, fallback: string, markdown: boolean): string {
  if (markdown) {
    const heading = content.match(/^#{1,6}\s+(.+)$/m)
    if (heading) return heading[1].trim()
  }
  return fallback
}

function buildSkill(skillId: string, entries: Array<[string, string]>): Skill {
  let name = skillId
  let description = ''
  const files: SkillFile[] = entries.map(([relative, content]) => {
    const markdown = relative.endsWith('.md')
    const fileName = relative.split('/').pop() ?? relative
    const segments = relative.split('/')
    const group = segments.length > 1 ? segments.slice(0, -1).join('/') : '概览'
    if (relative === 'SKILL.md') {
      const parsed = parseFrontmatter(content)
      name = parsed.data.name || name
      description = parsed.data.description || description
    }
    return {
      id: relative,
      name: fileName,
      group,
      title: toTitle(content, fileName, markdown),
      language: markdown ? 'markdown' : 'javascript',
      markdown,
      content
    }
  })

  const rank = (file: SkillFile): number => {
    if (file.id === 'SKILL.md') return 0
    if (file.group === 'references') return 1
    if (file.group === 'assets') return 2
    return 3
  }
  files.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))

  return { id: skillId, name, description, files }
}

export const skills: Skill[] = (() => {
  const grouped = new Map<string, Array<[string, string]>>()
  for (const [absolute, content] of Object.entries(RAW_FILES)) {
    const stripped = absolute.replace(/^\.\//, '')
    const slash = stripped.indexOf('/')
    if (slash === -1) continue
    const skillId = stripped.slice(0, slash)
    const relative = stripped.slice(slash + 1)
    if (!grouped.has(skillId)) grouped.set(skillId, [])
    grouped.get(skillId)!.push([relative, content])
  }
  return [...grouped.entries()]
    .map(([skillId, entries]) => buildSkill(skillId, entries))
    .sort((a, b) => a.name.localeCompare(b.name))
})()

export function findSkill(id: string): Skill | undefined {
  return skills.find((skill) => skill.id === id)
}
