import type { OutputProfile } from './export-profile'
import type { PresentationProject } from './types'
import type { StudioProject } from './schema'
import { STUDIO_SCHEMA_VERSION } from './schema'
import { recordDiagnostic } from './diagnostics'

export const STUDIO_SDK_VERSION = '1.0.0'
export const STUDIO_SUPPORTED_SCHEMAS = [STUDIO_SCHEMA_VERSION] as const

export interface PluginContext {
  sdkVersion: string
  schemaVersion: number
  now: string
}

export interface StudioPlugin {
  id: string
  version: string
  minSdkVersion?: string
  schemas?: number[]
  onRegister?: (context: PluginContext) => void
  onProjectOpen?: (project: PresentationProject, context: PluginContext) => void
  onProjectSave?: (document: StudioProject, context: PluginContext) => void
  onBeforeExport?: (profile: OutputProfile, context: PluginContext) => void
}

export interface PluginFailure {
  plugin: string
  hook: string
  message: string
}

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const plugins = new Map<string, StudioPlugin>()

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    value
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

function context(): PluginContext {
  return { sdkVersion: STUDIO_SDK_VERSION, schemaVersion: STUDIO_SCHEMA_VERSION, now: new Date().toISOString() }
}

function run<T>(hook: string, action: (plugin: StudioPlugin) => T): PluginFailure[] {
  const failures: PluginFailure[] = []
  for (const plugin of plugins.values()) {
    try {
      action(plugin)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ plugin: plugin.id, hook, message })
      recordDiagnostic('orchestration', 'plugin-failed', 'error', { plugin: plugin.id, hook, message })
    }
  }
  return failures
}

export function registerStudioPlugin(plugin: StudioPlugin): () => void {
  if (!PLUGIN_ID.test(plugin.id)) throw new Error(`插件 id 不合法：${plugin.id}`)
  if (!VERSION.test(plugin.version)) throw new Error(`插件版本必须为 semver：${plugin.version}`)
  if (plugins.has(plugin.id)) throw new Error(`插件已注册：${plugin.id}`)
  if (plugin.minSdkVersion && compareVersions(plugin.minSdkVersion, STUDIO_SDK_VERSION) > 0) {
    throw new Error(`插件 ${plugin.id} 需要 SDK ${plugin.minSdkVersion}，当前为 ${STUDIO_SDK_VERSION}`)
  }
  const schemas = plugin.schemas ?? [...STUDIO_SUPPORTED_SCHEMAS]
  if (!schemas.includes(STUDIO_SCHEMA_VERSION)) {
    throw new Error(`插件 ${plugin.id} 不支持当前工程 schema v${STUDIO_SCHEMA_VERSION}`)
  }
  plugin.onRegister?.(context())
  plugins.set(plugin.id, plugin)
  return () => plugins.delete(plugin.id)
}

export function hasStudioPlugins(): boolean {
  return plugins.size > 0
}

export function listStudioPlugins(): ReadonlyArray<Pick<StudioPlugin, 'id' | 'version'>> {
  return [...plugins.values()].map(({ id, version }) => ({ id, version }))
}

export function runProjectOpenHooks(project: PresentationProject): PluginFailure[] {
  return run('onProjectOpen', (plugin) => plugin.onProjectOpen?.(project, context()))
}

export function runProjectSaveHooks(document: StudioProject): PluginFailure[] {
  return run('onProjectSave', (plugin) => plugin.onProjectSave?.(document, context()))
}

export function runBeforeExportHooks(profile: OutputProfile): PluginFailure[] {
  return run('onBeforeExport', (plugin) => plugin.onBeforeExport?.(profile, context()))
}

export function clearStudioPlugins(): void {
  plugins.clear()
}
