export type DiagnosticChannel = 'resource' | 'storage' | 'orchestration' | 'export'
export type DiagnosticLevel = 'info' | 'warn' | 'error'

export interface DiagnosticEvent {
  at: number
  channel: DiagnosticChannel
  name: string
  level: DiagnosticLevel
  detail: Record<string, string | number | boolean | null>
}

const MAX_EVENTS = 200
const events: DiagnosticEvent[] = []
let sink: ((event: DiagnosticEvent) => void) | null = null

declare global {
  interface Window {
    __STUDIO_DIAGNOSTICS__?: DiagnosticEvent[]
  }
}

export function recordDiagnostic(
  channel: DiagnosticChannel,
  name: string,
  level: DiagnosticLevel = 'info',
  detail: DiagnosticEvent['detail'] = {}
): void {
  const event: DiagnosticEvent = { at: Date.now(), channel, name, level, detail }
  events.push(event)
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  if (level === 'error') console.warn(`[studio:${channel}] ${name}`, detail)
  sink?.(event)
}

export function onDiagnostic(listener: (event: DiagnosticEvent) => void): () => void {
  sink = listener
  return () => {
    if (sink === listener) sink = null
  }
}

export function diagnosticsSnapshot(): DiagnosticEvent[] {
  return events.map((event) => ({ ...event, detail: { ...event.detail } }))
}

export function clearDiagnostics(): void {
  events.length = 0
}

if (typeof window !== 'undefined') window.__STUDIO_DIAGNOSTICS__ = events
