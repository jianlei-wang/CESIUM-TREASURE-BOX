import {
  Credit,
  EllipsoidTerrainProvider,
  OpenStreetMapImageryProvider,
  UrlTemplateImageryProvider,
  createWorldTerrainAsync,
  type ImageryProvider,
  type TerrainProvider
} from 'cesium'

export type DataSourceKind = 'imagery' | 'terrain' | 'tileset'
export type DataSourceHealth = 'unknown' | 'healthy' | 'degraded' | 'failed' | 'offline'

export interface DataSourceDefinition {
  id: string
  kind: DataSourceKind
  name: string
  provider: 'bing' | 'osm' | 'world-terrain' | 'ellipsoid' | 'tileset'
  url?: string
  credit?: string
  timeoutMs: number
  retries: number
  fallbackId?: string
  requiresToken?: boolean
  attributionRequired: boolean
}

export interface DataSourceState {
  id: string
  health: DataSourceHealth
  failures: number
  lastError: string
  lastCheckedAt: string | null
}

const BING_SUBDOMAINS = ['0', '1', '2', '3']
const BING_CREDIT = new Credit('© Microsoft Bing Maps')

function toQuadKey(x: number, y: number, level: number): string {
  let key = ''
  for (let bit = level; bit > 0; bit -= 1) {
    let digit = 0
    const mask = 1 << (bit - 1)
    if ((x & mask) !== 0) digit += 1
    if ((y & mask) !== 0) digit += 2
    key += String(digit)
  }
  return key
}

export const DEFAULT_DATA_SOURCES: DataSourceDefinition[] = [
  {
    id: 'imagery_bing',
    kind: 'imagery',
    name: 'Bing Maps 卫星影像',
    provider: 'bing',
    url: 'https://ecn.t{s}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=1',
    credit: '© Microsoft Bing Maps',
    timeoutMs: 8000,
    retries: 2,
    fallbackId: 'imagery_osm',
    attributionRequired: true
  },
  {
    id: 'imagery_osm',
    kind: 'imagery',
    name: 'OpenStreetMap',
    provider: 'osm',
    url: 'https://tile.openstreetmap.org/',
    credit: '© OpenStreetMap contributors',
    timeoutMs: 10000,
    retries: 1,
    attributionRequired: true
  },
  {
    id: 'terrain_world',
    kind: 'terrain',
    name: 'Cesium World Terrain',
    provider: 'world-terrain',
    timeoutMs: 12000,
    retries: 1,
    fallbackId: 'terrain_ellipsoid',
    requiresToken: true,
    attributionRequired: true
  },
  {
    id: 'terrain_ellipsoid',
    kind: 'terrain',
    name: '椭球地形',
    provider: 'ellipsoid',
    timeoutMs: 1000,
    retries: 0,
    attributionRequired: false
  }
]

export class DataSourceRegistry {
  private definitions = new Map<string, DataSourceDefinition>()
  private states = new Map<string, DataSourceState>()

  constructor(definitions: DataSourceDefinition[] = DEFAULT_DATA_SOURCES) {
    for (const definition of definitions) this.register(definition)
  }

  register(definition: DataSourceDefinition): void {
    this.definitions.set(definition.id, definition)
    if (!this.states.has(definition.id)) {
      this.states.set(definition.id, {
        id: definition.id,
        health: 'unknown',
        failures: 0,
        lastError: '',
        lastCheckedAt: null
      })
    }
  }

  get(id: string): DataSourceDefinition | null {
    return this.definitions.get(id) ?? null
  }

  fallbackOf(id: string): DataSourceDefinition | null {
    const definition = this.definitions.get(id)
    return definition?.fallbackId ? (this.definitions.get(definition.fallbackId) ?? null) : null
  }

  list(kind?: DataSourceKind): DataSourceDefinition[] {
    return [...this.definitions.values()].filter((item) => !kind || item.kind === kind)
  }

  state(id: string): DataSourceState {
    const state = this.states.get(id)
    if (state) return { ...state }
    return { id, health: 'unknown', failures: 0, lastError: '', lastCheckedAt: null }
  }

  mark(id: string, health: DataSourceHealth, error = ''): void {
    const state = this.states.get(id) ?? { id, health: 'unknown', failures: 0, lastError: '', lastCheckedAt: null }
    state.health = health
    state.lastError = error
    state.failures = health === 'failed' || health === 'degraded' ? state.failures + 1 : 0
    state.lastCheckedAt = new Date().toISOString()
    this.states.set(id, state)
  }

  snapshot(): DataSourceState[] {
    return [...this.states.values()].map((state) => ({ ...state }))
  }
}

export function createImageryProvider(definition: DataSourceDefinition): ImageryProvider {
  if (definition.provider === 'osm') {
    return new OpenStreetMapImageryProvider({ url: definition.url ?? 'https://tile.openstreetmap.org/' })
  }
  return new UrlTemplateImageryProvider({
    url: definition.url ?? 'https://ecn.t{s}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=1',
    subdomains: BING_SUBDOMAINS,
    maximumLevel: 19,
    credit: definition.credit ? new Credit(definition.credit) : BING_CREDIT,
    customTags: {
      quadkey: (_provider: unknown, x: number, y: number, level: number) => toQuadKey(x, y, level)
    }
  })
}

export async function createTerrainProvider(definition: DataSourceDefinition): Promise<TerrainProvider> {
  if (definition.provider === 'ellipsoid') return new EllipsoidTerrainProvider()
  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error(`地形服务超时（${definition.timeoutMs}ms）`)), definition.timeoutMs)
  })
  const task = createWorldTerrainAsync({ requestVertexNormals: true })
  return Promise.race([task, timeout])
}
