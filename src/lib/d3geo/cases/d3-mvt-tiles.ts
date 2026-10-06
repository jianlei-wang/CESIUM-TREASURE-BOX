import { Cartesian2, JulianDate, PropertyBag, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium'
import type { D3CaseSpec } from '../types'
import { mulberry32 } from '../data'
import { categorical, ramp } from '../palettes'
import { addLabel, addPolygon, addPolyline, type LonLat } from '../render'

const CENTER: LonLat = [116.41, 39.9]
const KINDS = ['building', 'road', 'water', 'poi']

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z)
}

function tileToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

function tileToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

const spec: D3CaseSpec = {
  id: 'd3-mvt-tiles',
  meta: {
    title: 'MVT 矢量瓦片直载',
    subtitle: '瓦片分块要素 · Cesium3DTileStyle per-feature 样式',
    description: '按瓦片层级分块生成矢量要素并逐要素着色，点击拾取查看要素属性。',
    tag: 'D3 矢量瓦片 · MVT',
    accent: '#a78bfa',
    tips: [
      '按 z/x/y 瓦片划分数据分块，每个瓦片独立生成若干多边形与线要素',
      '逐要素从分类色板与数值色带取色，模拟 Cesium3DTileStyle 的逐要素样式',
      'ScreenSpaceEventHandler 点击拾取实体属性，实时回显瓦片、类别与数值'
    ]
  },
  defaults: {
    level: 11,
    density: 4,
    showLabels: false,
    showTileEdges: true,
    seed: 20261006
  },
  camera: { lon: 116.41, lat: 39.9, height: 260000, pitch: -60 },
  controls: [
    { kind: 'range', key: 'level', label: '瓦片层级 z', min: 4, max: 14, step: 1 },
    { kind: 'range', key: 'density', label: '每块要素密度', min: 1, max: 8, step: 1 },
    { kind: 'checkbox', key: 'showLabels', label: '显示属性标签' },
    { kind: 'checkbox', key: 'showTileEdges', label: '显示瓦片边界' },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const level = Number(settings.level)
    const density = Number(settings.density)
    const showLabels = Boolean(settings.showLabels)
    const showTileEdges = Boolean(settings.showTileEdges)
    const rng = mulberry32(Number(settings.seed))

    const cx = lonToTileX(CENTER[0], level)
    const cy = latToTileY(CENTER[1], level)
    let featureCount = 0
    const tiles: Array<{ x: number; y: number }> = []

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        tiles.push({ x: cx + dx, y: cy + dy })
      }
    }

    for (const tile of tiles) {
      const west = tileToLon(tile.x, level)
      const east = tileToLon(tile.x + 1, level)
      const north = tileToLat(tile.y, level)
      const south = tileToLat(tile.y + 1, level)
      const spanX = east - west
      const spanY = north - south

      if (showTileEdges) {
        addPolyline(
          ctx.dataSource,
          [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south]
          ],
          { width: 1.2, color: '#64748b', alpha: 0.8 }
        )
      }

      const tileTag = `${level}/${tile.x}/${tile.y}`
      for (let i = 0; i < density; i += 1) {
        const kindIndex = Math.floor(rng() * KINDS.length)
        const kind = KINDS[kindIndex]
        const value = Math.round(1 + rng() * 99)
        const lon = west + spanX * (0.15 + rng() * 0.7)
        const lat = south + spanY * (0.15 + rng() * 0.7)
        const color = ramp('turbo', value / 100)
        const styleColor = kindIndex % 2 === 0 ? color : categorical(kindIndex)

        if (kind === 'road' || kind === 'water') {
          const len = (kind === 'road' ? 0.22 : 0.3) * spanX
          const line = addPolyline(
            ctx.dataSource,
            [
              [lon - len / 2, lat - len * 0.15],
              [lon, lat],
              [lon + len / 2, lat + len * 0.15]
            ],
            {
              width: kind === 'road' ? 2.5 : 3.5,
              color: kind === 'water' ? '#38bdf8' : styleColor,
              alpha: 0.95
            }
          )
          line.properties = new PropertyBag({ tile: tileTag, kind, value })
        } else {
          const half = spanX * 0.06
          const entity = addPolygon(
            ctx.dataSource,
            [
              [lon - half, lat - half],
              [lon + half, lat - half],
              [lon + half, lat + half],
              [lon - half, lat + half]
            ],
            { color: styleColor, alpha: 0.85, outline: true, outlineColor: '#0f172a', outlineWidth: 1 }
          )
          entity.properties = new PropertyBag({ tile: tileTag, kind, value })
        }

        if (showLabels) {
          addLabel(ctx.dataSource, lon, lat, `${kind}:${value}`, {
            font: '10px sans-serif',
            color: '#e2e8f0',
            scaleByDistance: [120000, 0.25, 900000, 1.2],
            disableDepthTest: true
          })
        }
        featureCount += 1
      }
    }

    ctx.legend([
      { label: 'turbo（数值）', color: ramp('turbo', 1) },
      { label: 'categorical（类别）', color: categorical(0) }
    ])
    ctx.status(`MVT 瓦片 ${level} 级 · ${tiles.length} 块 · ${featureCount} 个要素 · 点击要素查看属性`)

    const handler = new ScreenSpaceEventHandler(ctx.viewer.scene.canvas)
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      const picked = ctx.viewer.scene.pick(movement.position)
      if (!picked || !picked.id || !picked.id.properties) {
        ctx.status('拾取：未命中矢量要素')
        return
      }
      const attrs = picked.id.properties.getValue(JulianDate.now()) as Record<string, unknown>
      ctx.status(`MVT 属性 · 瓦片 ${attrs.tile} · 类别 ${attrs.kind} · value=${attrs.value}`)
    }, ScreenSpaceEventType.LEFT_CLICK)
    ctx.onCleanup(() => handler.destroy())
  }
}

export default spec
