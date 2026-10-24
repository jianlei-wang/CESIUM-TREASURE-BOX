import { recordDiagnostic } from './diagnostics'
import { normalizeProject } from './normalize'
import { documentToRuntime, runtimeToDocument, type StudioProject } from './schema'
import type { PresentationProject } from './types'

const LOCAL_STORAGE_KEY = 'cesium.presentation.studio.v1'
const LOCAL_BACKUP_KEY = 'cesium.presentation.studio.backup.v1'
const INDEXED_DB_NAME = 'cesium-presentation-studio'
const INDEXED_DB_VERSION = 1
const INDEXED_DB_STORE = 'workspace'
const INDEXED_DB_KEY = 'current'

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

export type SaveErrorCode = 'quota' | 'permission' | 'corrupt' | 'future-version' | 'indexeddb' | 'unknown'

export type SaveResult =
  | { ok: true; location: 'indexeddb+local' | 'localstorage'; bytes: number; at: string; warning?: string }
  | { ok: false; code: SaveErrorCode; message: string; backup: Blob | null }

export type ReadResult =
  | { ok: true; store: StudioStore; location: 'indexeddb' | 'localstorage'; warnings: string[] }
  | { ok: false; code: SaveErrorCode; message: string; raw: string | null }

export interface StorageDiagnostics {
  indexedDb: boolean
  localBytes: number | null
  estimatedQuota: number | null
  estimatedUsage: number | null
}

interface PersistedStore {
  format: 'cesium.studio'
  schemaVersion: 2
  currentId: string
  projects: StudioProject[]
  draft: { projectId: string; project: StudioProject; savedAt: string } | null
}

let lastReadWarning = ''

export function lastReadDiagnostics(): string {
  return lastReadWarning
}

function errorCode(error: unknown): SaveErrorCode {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED') return 'quota'
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'permission'
  }
  if (error instanceof Error && /quota|storage full|exceeded/i.test(error.message)) return 'quota'
  return 'unknown'
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function backupOf(raw: string): Blob {
  return new Blob([raw], { type: 'application/json;charset=utf-8' })
}

function toPersisted(store: StudioStore): PersistedStore {
  return {
    format: 'cesium.studio',
    schemaVersion: 2,
    currentId: store.currentId,
    projects: store.projects.map((project) => runtimeToDocument(project)),
    draft: store.draft
      ? { projectId: store.draft.projectId, project: runtimeToDocument(store.draft.project), savedAt: store.draft.savedAt }
      : null
  }
}

function storeFromPersisted(parsed: PersistedStore): StudioStore {
  const projects = parsed.projects.map((document) => documentToRuntime(document))
  if (!projects.length) throw new Error('工程库为空')
  const currentId = projects.some((item) => item.id === parsed.currentId) ? parsed.currentId : projects[0].id
  let draft: StudioDraft | null = null
  if (parsed.draft && parsed.draft.project) {
    const draftProject = documentToRuntime(parsed.draft.project)
    if (projects.some((item) => item.id === draftProject.id)) {
      draft = {
        projectId: draftProject.id,
        project: draftProject,
        savedAt: typeof parsed.draft.savedAt === 'string' ? parsed.draft.savedAt : new Date().toISOString()
      }
    }
  }
  return { version: 1, currentId, projects, draft }
}

function parsePersisted(raw: string): StudioStore | null {
  const parsed = JSON.parse(raw) as Partial<PersistedStore> & {
    version?: number
    projects?: unknown[]
    draft?: { projectId?: string; project?: unknown; savedAt?: string } | null
  }
  if (parsed.format === 'cesium.studio' && parsed.schemaVersion === 2 && Array.isArray(parsed.projects)) {
    return storeFromPersisted(parsed as PersistedStore)
  }
  if (Array.isArray(parsed.projects) && parsed.projects.length) {
    const projects = parsed.projects.map((item) => documentToRuntime(runtimeToDocumentFromUnknown(item)))
    const currentId = projects.some((item) => item.id === parsed.currentId) ? String(parsed.currentId) : projects[0].id
    let draft: StudioDraft | null = null
    if (parsed.draft?.project && typeof parsed.draft.project === 'object') {
      const draftProject = documentToRuntime(runtimeToDocumentFromUnknown(parsed.draft.project))
      if (projects.some((item) => item.id === draftProject.id)) {
        draft = {
          projectId: draftProject.id,
          project: draftProject,
          savedAt: typeof parsed.draft.savedAt === 'string' ? parsed.draft.savedAt : new Date().toISOString()
        }
      }
    }
    return { version: 1, currentId, projects, draft }
  }
  return null
}

function runtimeToDocumentFromUnknown(value: unknown): StudioProject {
  if (typeof value !== 'object' || value === null) throw new Error('工程条目不是对象')
  const record = value as Record<string, unknown>
  if (record.format === 'cesium.studio') return record as unknown as StudioProject
  return runtimeToDocument(normalizeProject(record))
}

export function readStore(): StudioStore | null {
  lastReadWarning = ''
  let raw: string | null = null
  try {
    raw = localStorage.getItem(LOCAL_STORAGE_KEY)
  } catch (error) {
    lastReadWarning = `无法读取本地存储：${messageOf(error)}`
    recordDiagnostic('storage', 'read-unavailable', 'error', { message: messageOf(error) })
    return null
  }
  if (!raw) return null
  try {
    return parsePersisted(raw)
  } catch (error) {
    lastReadWarning = `本地工程数据损坏或不可读：${messageOf(error)}`
    recordDiagnostic('storage', 'read-corrupt', 'error', { message: messageOf(error), bytes: raw.length })
    try {
      localStorage.setItem(LOCAL_BACKUP_KEY, raw)
    } catch {
      /* 备份失败时由调用方提供导出 */
    }
    return null
  }
}

export function writeStore(store: StudioStore): SaveResult {
  const persisted = JSON.stringify(toPersisted(store))
  try {
    localStorage.setItem(LOCAL_BACKUP_KEY, localStorage.getItem(LOCAL_STORAGE_KEY) ?? '')
    localStorage.setItem(LOCAL_STORAGE_KEY, persisted)
    return { ok: true, location: 'localstorage', bytes: new Blob([persisted]).size, at: new Date().toISOString() }
  } catch (error) {
    const code = errorCode(error)
    recordDiagnostic('storage', 'write-failed', 'error', { code, message: messageOf(error) })
    return {
      ok: false,
      code,
      message: code === 'quota' ? '浏览器本地存储空间不足，保存失败' : `保存失败：${messageOf(error)}`,
      backup: backupOf(persisted)
    }
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'))
      return
    }
    const request = indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(INDEXED_DB_STORE)) database.createObjectStore(INDEXED_DB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'))
    request.onblocked = () => reject(new Error('IndexedDB 被其他页面占用'))
  })
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'))
  })
}

async function writeIndexedDb(value: string): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(INDEXED_DB_STORE, 'readwrite')
    await idbRequest(transaction.objectStore(INDEXED_DB_STORE).put(value, INDEXED_DB_KEY))
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'))
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务被中止'))
    })
  } finally {
    database.close()
  }
}

async function readIndexedDb(): Promise<string | null> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(INDEXED_DB_STORE, 'readonly')
    const value = await idbRequest(transaction.objectStore(INDEXED_DB_STORE).get(INDEXED_DB_KEY))
    return typeof value === 'string' ? value : null
  } finally {
    database.close()
  }
}

export async function writeStoreSafe(store: StudioStore): Promise<SaveResult> {
  const persisted = JSON.stringify(toPersisted(store))
  const local = writeStore(store)
  try {
    await writeIndexedDb(persisted)
    return {
      ok: true,
      location: 'indexeddb+local',
      bytes: new Blob([persisted]).size,
      at: new Date().toISOString()
    }
  } catch (error) {
    if (local.ok) {
      recordDiagnostic('storage', 'write-degraded', 'warn', { message: messageOf(error) })
      return {
        ok: true,
        location: 'localstorage',
        bytes: local.bytes,
        at: local.at,
        warning: `IndexedDB 写入失败，已保留 localStorage 快照：${messageOf(error)}`
      }
    }
    const code = local.ok ? errorCode(error) : local.code
    recordDiagnostic('storage', 'write-failed', 'error', { code, message: messageOf(error) })
    return {
      ok: false,
      code,
      message: local.message,
      backup: local.backup ?? backupOf(persisted)
    }
  }
}

export async function readStoreSafe(): Promise<ReadResult> {
  const warnings: string[] = []
  try {
    const raw = await readIndexedDb()
    if (raw) {
      const store = parsePersisted(raw)
      if (store) {
        recordDiagnostic('storage', 'read', 'info', { location: 'indexeddb', warnings: warnings.length })
        return { ok: true, store, location: 'indexeddb', warnings }
      }
      warnings.push('IndexedDB 中的工程数据版本过旧或无效，已回退到本地快照')
    }
  } catch (error) {
    warnings.push(`IndexedDB 不可用：${messageOf(error)}`)
  }
  const local = readStore()
  if (local) {
    recordDiagnostic('storage', 'read', 'info', { location: 'localstorage', warnings: warnings.length })
    return { ok: true, store: local, location: 'localstorage', warnings }
  }
  const raw = (() => {
    try {
      return localStorage.getItem(LOCAL_STORAGE_KEY)
    } catch {
      return null
    }
  })()
  if (lastReadWarning) {
    recordDiagnostic('storage', 'read-failed', 'error', { message: lastReadWarning })
    return { ok: false, code: 'corrupt', message: lastReadWarning, raw }
  }
  return { ok: false, code: 'corrupt', message: '未发现本地工程数据', raw }
}

export async function storageDiagnostics(): Promise<StorageDiagnostics> {
  let indexedDb = false
  try {
    indexedDb = typeof indexedDB !== 'undefined'
  } catch {
    indexedDb = false
  }
  let localBytes: number | null = null
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    localBytes = raw ? new Blob([raw]).size : 0
  } catch {
    localBytes = null
  }
  let estimatedQuota: number | null = null
  let estimatedUsage: number | null = null
  try {
    const estimate = await navigator.storage?.estimate?.()
    estimatedQuota = estimate?.quota ?? null
    estimatedUsage = estimate?.usage ?? null
  } catch {
    estimatedQuota = null
  }
  return { indexedDb, localBytes, estimatedQuota, estimatedUsage }
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
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
