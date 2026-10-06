import type { Primitive } from 'cesium'
import type { D3CaseSpec } from '../types'
import type { AggregateCell } from '../spatial/hexbin'
import { hexRing } from '../spatial/hexbin'
import { h3binBuffer } from '../spatial/h3'
import { generateSyntheticPoints, SYNTHETIC_PATTERNS, SYNTHETIC_SIZES, type SyntheticPattern } from '../data/synthetic'
import { bufferByteLength } from '../core/buffer'
import { createGeoLOD, type GeoLODLevel } from '../core/lod'
import { renderPointBuffer } from '../render/points'
import { renderCellPolygons } from '../render/polygons'
import { aggregateInWorker } from '../workers/client'
import { ramp } from '../palettes'
import { formatCount } from '../core/geo'
import { PALETTE_OPTIONS, rampLegend } from './_kit'

type Mode = 'points' | 'h3' | 'hexbin' | 'grid'

const POINT_LOD = createGeoLOD([
  { maxHeight: 500_000, resolution: 1_000_000, label: 'LOD 6' },
  { maxHeight: 1_500_000, resolution: 640_000, label: 'LOD 5' },
  { maxHeight: 4_000_000, resolution: 320_000, label: 'LOD 4' },
  { maxHeight: 10_000_000, resolution: 160_000, label: 'LOD 3' },
  { maxHeight: 20_000_000, resolution: 80_000, label: 'LOD 2' },
  { maxHeight: Number.POSITIVE_INFINITY, resolution: 40_000, label: 'LOD 1' }
])

const spec: D3CaseSpec = {
  id: 'd3-synthetic-lab',
  meta: {
    title: 'Synthetic Data Lab · 性能压测',
    subtitle: '十万 → 千万级合成数据，明确标注用于压力测试',
    description:
      '本案例是全模块唯一使用随机数据的入口，专用于性能压力测试：以 TypedArray 生成 1 万 – 1000 万合成点，测试 PointPrimitive / H3 / Hexbin / Grid 与 Worker 在极限数据量下的表现。此处数据为合成数据，不代表真实业务。',
    tag: 'Synthetic · 压测 · TypedArray',
    accent: '#f87171',
    tips: [
      '合成数据仅用于性能压测，界面上明确标注，不冒充真实数据',
      '同一列式缓冲可在点渲染、H3 聚合、Worker 聚合之间复用',
      'LOD 让 1000 万点也能稳定渲染，不需要全量 Entity'
    ]
  },
  defaults: {
    count: 1_000_000,
    pattern: 'clustered',
    mode: 'points',
    palette: 'inferno',
    pointSize: 3
  },
  camera: { lon: 106, lat: 34, height: 7_500_000, pitch: -90 },
  controls: [
    { kind: 'select', key: 'count', label: '合成数据量', options: SYNTHETIC_SIZES.map((size) => ({ value: String(size), label: `${formatCount(size)} points` })) },
    { kind: 'select', key: 'pattern', label: '分布模式', options: SYNTHETIC_PATTERNS.map((p) => ({ value: p.value, label: p.label })) },
    {
      kind: 'select',
      key: 'mode',
      label: '渲染模式',
      options: [
        { value: 'points', label: 'GPU 点图元' },
        { value: 'h3', label: 'H3 聚合' },
        { value: 'hexbin', label: 'Hexbin (Worker)' },
        { value: 'grid', label: 'Grid (Worker)' }
      ]
    },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS },
    { kind: 'range', key: 'pointSize', label: '点大小(px)', min: 1, max: 10, step: 0.5 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const palette = String(settings.palette)
    const mode = String(settings.mode) as Mode
    const count = Number(settings.count)
    let disposed = false
    ctx.onCleanup(() => {
      disposed = true
    })

    const end = ctx.profiler.time('Generate')
    const buffer = generateSyntheticPoints(count, { pattern: String(settings.pattern) as SyntheticPattern, categoryCount: 6 })
    ctx.profiler.set('Generate', `${end().toFixed(0)} ms`)
    ctx.profiler.set('Input', formatCount(buffer.length))
    ctx.profiler.set('Memory', `${(bufferByteLength(buffer) / 1048576).toFixed(1)} MB`)
    ctx.profiler.set('Mode', mode.toUpperCase())

    let primitive: Primitive | undefined
    const renderCells = (cells: AggregateCell[]): void => {
      if (primitive) {
        ctx.viewer.scene.primitives.remove(primitive)
        primitive = undefined
      }
      const maxCount = cells.reduce((acc, cell) => Math.max(acc, cell.count), 1)
      primitive = renderCellPolygons(cells, {
        alpha: 0.8,
        heightOf: (cell) => 400 + (cell.count / maxCount) * 300_000,
        colorOf: (cell) => ramp(palette, Math.pow(cell.count / maxCount, 0.5))
      })
      if (primitive) ctx.addPrimitive(primitive)
      ctx.profiler.set('Cells', formatCount(cells.length))
      ctx.profiler.set('Compression', `${((1 - cells.length / buffer.length) * 100).toFixed(1)}%`)
      ctx.status(`${formatCount(buffer.length)} 合成点 → ${formatCount(cells.length)} 聚合单元（合成数据，仅压测）`)
    }

    if (mode === 'points') {
      const collection = ctx.pointCollection()
      let current: GeoLODLevel | undefined
      const render = (level: GeoLODLevel): void => {
        const t = ctx.profiler.time('Render')
        collection.removeAll()
        const result = renderPointBuffer(collection, buffer, {
          mode: 'value',
          palette,
          valueDomain: [0, 100],
          pixelSize: Number(settings.pointSize),
          maxPoints: level.resolution,
          alpha: 0.9
        })
        ctx.profiler.set('Rendered', formatCount(result.rendered))
        ctx.profiler.set('LOD', level.label)
        ctx.profiler.set('Render', `${t().toFixed(1)} ms`)
        ctx.status(`${formatCount(buffer.length)} 合成点 · 抽稀 1/${result.stride} · 渲染 ${formatCount(result.rendered)}（合成数据，仅压测）`)
      }
      current = POINT_LOD.resolve(ctx.viewer.camera.positionCartographic.height)
      render(current)
      ctx.onFrame(() => {
        const level = POINT_LOD.resolve(ctx.viewer.camera.positionCartographic.height)
        if (!current || level.resolution !== current.resolution) {
          current = level
          render(level)
        }
      })
    } else if (mode === 'h3') {
      const t = ctx.profiler.time('Aggregate')
      renderCells(h3binBuffer(buffer, 3))
      ctx.profiler.set('Aggregate', `${t().toFixed(0)} ms`)
    } else {
      const t = ctx.profiler.time('Worker')
      aggregateInWorker(
        { mode, positions: buffer.positions, values: buffer.values, param: mode === 'hexbin' ? 0.8 : 2, lat0: 34 },
        [buffer.positions.buffer, buffer.values.buffer]
      )
        .then((response) => {
          ctx.profiler.set('Worker', `${t().toFixed(0)} ms`)
          if (disposed) return
          const cells: AggregateCell[] = []
          for (let i = 0; i < response.count; i += 1) {
            const lon = response.lon[i]
            const lat = response.lat[i]
            const cellCount = response.cellCounts[i]
            const polygon = mode === 'hexbin'
              ? hexRing(lon, lat, 0.8)
              : [
                  [lon - 1, lat - 1],
                  [lon + 1, lat - 1],
                  [lon + 1, lat + 1],
                  [lon - 1, lat + 1]
                ] as Array<[number, number]>
            cells.push({ key: String(i), lon, lat, polygon, count: cellCount, sum: response.sum[i], mean: cellCount ? response.sum[i] / cellCount : 0, min: response.min[i], max: response.max[i] })
          }
          renderCells(cells)
        })
        .catch(() => {
          /* worker failure ignored for stress lab */
        })
    }

    ctx.legend([rampLegend(palette, '值 / 数量 低→高'), { label: '合成数据 · 仅压测', color: '#f87171' }])
  }
}

export default spec
