import { normalizeProject } from './normalize'
import type { PresentationProject } from './types'

const STORAGE_KEY = 'cesium.presentation.studio.v1'

export interface StudioDraft {
  projectId: string
  project: PresentationProject
  savedAt: string
}

export interface StudioStore {
  version: 1
  currentId: string
  projects: PresentationProject[]
  draft: StudioDraft | null
}

export function readStore(): StudioStore | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StudioStore>
    if (!Array.isArray(parsed.projects) || !parsed.projects.length) return null
    const projects = parsed.projects.map((item) => normalizeProject(item))
    const currentId = typeof parsed.currentId === 'string' && projects.some((item) => item.id === parsed.currentId)
      ? parsed.currentId
      : projects[0].id
    let draft: StudioDraft | null = null
    if (parsed.draft && typeof parsed.draft === 'object' && parsed.draft.project) {
      const draftProject = normalizeProject(parsed.draft.project)
      if (projects.some((item) => item.id === draftProject.id)) {
        draft = {
          projectId: draftProject.id,
          project: draftProject,
          savedAt: typeof parsed.draft.savedAt === 'string' ? parsed.draft.savedAt : new Date().toISOString()
        }
      }
    }
    return {
      version: 1,
      currentId,
      projects,
      draft
    }
  } catch {
    return null
  }
}

export function writeStore(store: StudioStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* 存储空间不足时静默失败，用户仍可导出工程文件 */
  }
}

export function downloadText(content: string, filename: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  downloadBlob(blob, filename)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
