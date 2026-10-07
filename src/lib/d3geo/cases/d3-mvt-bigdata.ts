import type { D3CaseSpec } from '../types'
import type { Bounds, GeoFeature } from '../data/loaders'
import { parseTopoJsonFeatures } from '../data/loaders'
import { lonLatToTile, tileBounds, tileFeatures, renderTileGeometry, type TileCoord } from '../render/tile-renderer'
import { tileInWorker } from '../workers/client'
import { addPolyline } from '../render'
import { formatCount } from '../core/geo'
import { loadWorldTopo } from './_data'
import { PALETTE_OPTIONS, rampLegend } from './_kit'

type RegionKey = 'world' | 'china' | 'europe'

const REGIONS: Record<RegionKey, { bounds: Bounds; camera: { lon: number; lat: number; height: number } }> = {
  world: { bounds: { west: -180, south: -58, east: 180, north: 72 }, camera: { lon: 20, lat: 20, height: 24_000_000 } },
  china: { bounds: { west: 73, south: 18, east: 135, north: 54 }, camera: { lon: 104, lat: 35, height: 5_500_000 } },
  europe: { bounds: { west: -12, south: 35, east: 30, north: 60 }, camera: { lon: 9, lat: 48, height: 5_200_000 } }
}

function enumerateTiles(bounds: Bounds, z: number, maxTiles: number): TileCoord[] {
  const nw = lonLatToTile(bounds.west, bounds.north, z)
  const se = lonLatToTile(bounds.east, bounds.south, z)
  const x0 = Math.max(0, Math.floor(nw.x))
  const x1 = Math.min(2 ** z - 1, Math.floor(se.x))
  const y0 = Math.max(0, Math.floor(nw.y))
  const y1 = Math.min(2 ** z - 1, Math.floor(se.y))
  const tiles: TileCoord[] = []
  for (let x = x0; x <= x1 && tiles.length < maxTiles; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      tiles.push({ z, x, y })
      if (tiles.length >= maxTiles) break
    }
  }
  return tiles
}

const spec: D3CaseSpec = {
  id: 'd3-mvt-bigdata',
  meta: {
    title: 'MVT 矢量瓦片大数据',
    subtitle: '真实边界 → z/x/y 切片 → PBF 编解码 → Primitive',
    description:
      '用世界国家真实边界构建完整矢量瓦片生命周期：按 z/x/y 裁剪要素、编码为 MVT（PBF）字节流、在 Worker 中解码，再把解码后的真实几何渲染回三维地球，缩放级别切换 LOD。',
    tag: 'MVT · PBF · Vector Tile · LOD',
    accent: '#2dd4bf',
    tips: [
      '要素来自真实 TopoJSON 边界，非随机 feature',
      '完整 z/x/y 生命周期：裁剪 → PBF 编码 → Worker 解码 → 渲染',
      '缩放级别 z 决定瓦片数量与细节，构成矢量瓦片 LOD'
    ]
  },
  defaults: {
    region: 'china',
    zoom: 3,
    extent: 4096,
    palette: 'viridis',
    showBoundaries: true
  },
  camera: { lon: 104, lat: 35, height: 5_500_000, pitch: -90 },
  controls: [
    {
      kind: 'select',
      key: 'region',
      label: '区域',
      options: [
        { value: 'world', label: '全球' },
        { value: 'china', label: '中国' },
        { value: 'europe', label: '欧洲' }
      ]
    },
    { kind: 'range', key: 'zoom', label: '瓦片级别 z', min: 1, max: 5, step: 1 },
    { kind: 'select', key: 'extent', label: '瓦片 extent', options: [ { value: '4096', label: '4096' }, { value: '8192', label: '8192' } ] },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS },
    { kind: 'checkbox', key: 'showBoundaries', label: '显示瓦片边界' }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const region = REGIONS[String(settings.region) as RegionKey] ?? REGIONS.china
    const palette = String(settings.palette)
    const extent = Number(settings.extent)
    const z = Number(settings.zoom)
    let disposed = false
    ctx.onCleanup(() => {
      disposed = true
    })
    ctx.status('加载真实世界边界并构建瓦片…')

    loadWorldTopo()
      .then((topo) => {
        if (disposed) return
        const features: GeoFeature[] = parseTopoJsonFeatures(topo, 'countries')
        const tiles = enumerateTiles(region.bounds, z, 160)
        return run(features, tiles)
      })
      .catch((error: unknown) => {
        if (!disposed) ctx.status(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
      })

    async function run(features: GeoFeature[], tiles: TileCoord[]): Promise<void> {
      let totalBytes = 0
      let totalFeatures = 0
      let totalMs = 0
      let renderedGeometries = 0
      let activeTiles = 0
      const counts: number[] = []
      const seen = new Set<string>()
      for (const coord of tiles) {
        if (disposed) return
        const geometries = tileFeatures(features, coord, extent)
        if (geometries.length === 0) continue
        const response = await tileInWorker({ tileName: 'countries', extent, geometries })
        if (disposed) return
        totalBytes += response.encodedBytes
        totalMs += response.elapsed
        counts.push(response.decoded.length)
        totalFeatures += response.decoded.length
        activeTiles += 1
        renderedGeometries += renderTileGeometry(ctx.dataSource, response.decoded, coord, extent, palette, seen)
        if (Boolean(settings.showBoundaries)) {
          const b = tileBounds(coord)
          addPolyline(
            ctx.dataSource,
            [
              [b.west, b.north],
              [b.east, b.north],
              [b.east, b.south],
              [b.west, b.south],
              [b.west, b.north]
            ],
            { width: 1, color: '#38bdf8', alpha: 0.5, height: 1000 }
          )
        }
      }
      const maxCount = counts.reduce((acc, value) => Math.max(acc, value), 1)
      ctx.profiler.set('Input Features', formatCount(features.length))
      ctx.profiler.set('Tiles', `${activeTiles}/${tiles.length}`)
      ctx.profiler.set('Rendered', formatCount(renderedGeometries))
      ctx.profiler.set('Decoded', formatCount(totalFeatures))
      ctx.profiler.set('PBF', `${(totalBytes / 1024).toFixed(1)} KB`)
      ctx.profiler.set('Worker', `${totalMs.toFixed(0)} ms`)
      ctx.profiler.set('LOD', `z${z} · ${maxCount} feat/tile`)
      ctx.status(`${activeTiles}/${tiles.length} 个真实瓦片 · 渲染 ${formatCount(renderedGeometries)} 个几何 · PBF ${(totalBytes / 1024).toFixed(1)} KB`)
      ctx.legend([rampLegend(palette, '瓦片要素密度')])
    }
  }
}

export default spec
