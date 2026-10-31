import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

let cache = { data: null, mtime: 0 }

export function emptyCatalog() {
  return { generatedAt: '', cases: [], categories: [] }
}

export async function loadCatalog(file) {
  if (!file) return emptyCatalog()
  try {
    const handle = await import('node:fs/promises').then((fs) => fs.stat(file))
    if (cache.data && handle.mtimeMs === cache.mtime) return cache.data
    const text = await readFile(file, 'utf8')
    const parsed = JSON.parse(text)
    const cases = Array.isArray(parsed.cases)
      ? parsed.cases
          .filter((item) => item && typeof item.id === 'string')
          .map((item) => ({
            id: item.id,
            title: typeof item.title === 'string' ? item.title : item.id,
            category: typeof item.category === 'string' ? item.category : 'unknown',
            categoryLabel: typeof item.categoryLabel === 'string' ? item.categoryLabel : '',
            available: item.available !== false
          }))
      : []
    const categories = Array.isArray(parsed.categories)
      ? parsed.categories
          .filter((item) => item && typeof item.id === 'string')
          .map((item) => ({ id: item.id, label: typeof item.label === 'string' ? item.label : item.id }))
      : []
    cache = { data: { generatedAt: parsed.generatedAt ?? '', cases, categories }, mtime: handle.mtimeMs }
    return cache.data
  } catch {
    return emptyCatalog()
  }
}

export function defaultCatalogFile(staticRoot) {
  return join(staticRoot, 'data/cases.json')
}
