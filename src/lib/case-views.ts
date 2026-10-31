import { runtimeConfig } from '../runtime-config'

export type CaseViewCounts = Record<string, number>

const API_ROOT = `${runtimeConfig.apiBaseUrl.replace(/\/$/, '')}/api`

async function safeFetch(input: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(input, init)
  } catch {
    return null
  }
}

export async function fetchCaseViews(ids: string[]): Promise<CaseViewCounts> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return {}
  const response = await safeFetch(`${API_ROOT}/views?ids=${encodeURIComponent(unique.join(','))}`, {
    headers: { Accept: 'application/json' }
  })
  if (!response?.ok) return {}
  try {
    const data = (await response.json()) as { views?: CaseViewCounts }
    const views: CaseViewCounts = {}
    for (const id of unique) {
      const value = Number(data.views?.[id])
      views[id] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
    }
    return views
  } catch {
    return {}
  }
}

export async function recordCaseView(id: string): Promise<number | null> {
  const response = await safeFetch(`${API_ROOT}/views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  })
  if (!response?.ok) return null
  try {
    const data = (await response.json()) as { views?: number }
    return typeof data.views === 'number' && data.views >= 0 ? data.views : null
  } catch {
    return null
  }
}

export function formatViewCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}万`
  return value.toLocaleString('zh-CN')
}
