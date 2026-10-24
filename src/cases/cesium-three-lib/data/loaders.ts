import { geodeticToEnu, createEnuOrigin, type EnuOrigin, type Vec3 } from '../core/GeoReference'
import { validateDataset, type GeoDataset } from './schema'

export interface LoadOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface LoadedDataset {
  dataset: GeoDataset
  origin: EnuOrigin
  localFeatures: Array<Record<string, unknown> & { enu: Vec3 }>
}

export class LoadCancelledError extends Error {
  constructor() {
    super('dataset load cancelled')
    this.name = 'LoadCancelledError'
  }
}

export async function loadDataset(url: string, options: LoadOptions = {}): Promise<LoadedDataset> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 12000)
  const onAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`dataset ${url} returned ${response.status}`)
    const dataset = validateDataset((await response.json()) as GeoDataset)
    if (options.signal?.aborted) throw new LoadCancelledError()
    const origin = createEnuOrigin(dataset.anchor.lon, dataset.anchor.lat, dataset.anchor.height)
    const localFeatures = dataset.features.map((feature) => {
      const lon = Number(feature.lon ?? dataset.anchor.lon)
      const lat = Number(feature.lat ?? dataset.anchor.lat)
      const height = Number(feature.height ?? 0)
      return { ...(feature as Record<string, unknown>), enu: geodeticToEnu(origin, lon, lat, height) }
    })
    return { dataset, origin, localFeatures }
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

export function assertFreshAnchor(previous: EnuOrigin | null, next: EnuOrigin, threshold = 50000): EnuOrigin {
  if (previous && Math.abs(previous.lon - next.lon) < 1e-9 && Math.abs(previous.lat - next.lat) < 1e-9) return previous
  if (previous) {
    const dx = (next.lon - previous.lon) * 111320 * Math.cos((next.lat * Math.PI) / 180)
    const dy = (next.lat - previous.lat) * 110540
    if (Math.hypot(dx, dy) > threshold) return next
  }
  return next
}
