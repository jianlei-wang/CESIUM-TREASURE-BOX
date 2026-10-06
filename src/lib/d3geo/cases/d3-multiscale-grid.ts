import type { Primitive } from 'cesium'
import type { D3CaseSpec } from '../types'
import type { AggregateCell } from '../spatial/hexbin'
import { hexRing } from '../spatial/hexbin'
import { h3binBuffer } from '../spatial/h3'
import { createGeoLOD, H3_LOD_LEVELS, type GeoLODLevel } from '../core/lod'
import { formatCount } from '../core/geo'
import { breaksFor, classifyValue, type ClassificationMethod } from '../analysis/statistics'
import { generateSyntheticPoints, SYNTHETIC_PATTERNS, type SyntheticPattern } from '../data/synthetic'
import { ramp } from '../palettes'
import { renderCellPolygons } from '../render/polygons'
import { aggregateInWorker } from '../workers/client'
import { CLASSIFICATION_OPTIONS, PALETTE_OPTIONS } from './_kit'

type Algorithm = 'h3' | 'hexbin' | 'grid'

const HEX_RADIUS_BY_LEVEL = [0.06, 0.12, 0.22, 0.4, 0.7, 1.2, 2, 3]
const GRID_SIZE_BY_LEVEL = [0.14, 0.28, 0.5, 0.9, 1.5, 2.5, 4, 6]

function squareRing(lon: number, lat: number, size: number): Array<[number, number]> {
  const half = size / 2
  return [
    [lon - half, lat - half],
    [lon + half, lat - half],
    [lon + half, lat + half],
    [lon - half, lat + half]
  ]
}

const spec: D3CaseSpec = {
  id: 'd3-multiscale-grid',
  meta: {
    title: '多尺度 H3 / Hexbin 地理聚合',
    subtitle: '相机高度 → 分辨率 → Worker 聚合 → Primitive',
    description:
      '全球到街区的 8 级尺度，相机高度自动切换聚合分辨率；H3 / Hexbin / Grid 三种空间算法实时切换，Worker 内完成分桶与统计，面聚合经 Primitive 批量绘制。',
    tag: 'H3 · Hexbin · 多尺度 LOD · Worker',
    accent: '#4ade80',
    tips: [
      '统一 createGeoLOD 把相机高度映射到 H3 res 1–8，全球到街区连续过渡',
      '聚合在 Web Worker 内完成，主线程只负责渲染与交互',
      '聚合单元用 Primitive 批量 GeometryInstance，而非逐条 Entity Polygon'
    ]
  },
  defaults: {
    count: 300_000,
    pattern: 'clustered',
    algorithm: 'h3',
    palette: 'viridis',
    classes: 7,
    classification: 'quantile',
    seed: 20261006
  },
  camera: { lon: 106, lat: 34, height: 7_500_000, pitch: -90 },
  controls: [
    {
      kind: 'select',
      key: 'count',
      label: '数据量',
      options: [100_000, 300_000, 500_000, 1_000_000].map((v) => ({ value: String(v), label: formatCount(v) }))
    },
    { kind: 'select', key: 'pattern', label: '分布模式', options: SYNTHETIC_PATTERNS.slice(0, 3).map((p) => ({ value: p.value, label: p.label })) },
    {
      kind: 'select',
      key: 'algorithm',
      label: '聚合算法',
      options: [
        { value: 'h3', label: 'H3 六边形' },
        { value: 'hexbin', label: 'Hexbin 蜂窝' },
        { value: 'grid', label: 'Grid 方格' }
      ]
    },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS },
    { kind: 'select', key: 'classification', label: '分级方法', options: CLASSIFICATION_OPTIONS },
    { kind: 'range', key: 'classes', label: '分级数', min: 3, max: 9, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const algorithm = String(settings.algorithm) as Algorithm
    const palette = String(settings.palette)
    const classes = Number(settings.classes)
    const classification = String(settings.classification) as ClassificationMethod
    const seed = Number(settings.seed)
    const pattern = String(settings.pattern) as SyntheticPattern
    const count = Number(settings.count)

    let disposed = false
    ctx.onCleanup(() => {
      disposed = true
    })

    const lod = createGeoLOD(H3_LOD_LEVELS)
    let currentLevel = lod.resolve(ctx.viewer.camera.positionCartographic.height)
    let primitive: Primitive | undefined
    let generating = false

    const renderCells = (cells: AggregateCell[], level: GeoLODLevel): void => {
      const end = ctx.profiler.time('Render')
      const counts = cells.map((cell) => cell.count)
      const breaks = breaksFor(classification, counts, classes)
      const maxCount = cells.reduce((acc, cell) => Math.max(acc, cell.count), 1)
      if (primitive) {
        ctx.viewer.scene.primitives.remove(primitive)
        primitive = undefined
      }
      primitive = renderCellPolygons(cells, {
        alpha: 0.82,
        heightOf: (cell) => 500 + (cell.count / maxCount) * 250_000,
        colorOf: (cell) => ramp(palette, (classifyValue(cell.count, breaks) + 0.5) / Math.max(1, classes))
      })
      if (primitive) ctx.addPrimitive(primitive)
      const renderMs = end()
      const compression = count > 0 ? 1 - cells.length / count : 0
      ctx.profiler.set('Input', formatCount(count))
      ctx.profiler.set('Cells', formatCount(cells.length))
      ctx.profiler.set('Compression', `${(compression * 100).toFixed(1)}%`)
      ctx.profiler.set('LOD', level.label)
      ctx.profiler.set('Resolution', algorithm === 'h3' ? `res ${level.resolution}` : `${level.label}`)
      ctx.profiler.set('Algorithm', algorithm.toUpperCase())
      ctx.profiler.set('Render', `${renderMs.toFixed(1)} ms`)
      ctx.status(`${formatCount(count)} 点 → ${formatCount(cells.length)} 单元 · 压缩 ${(compression * 100).toFixed(1)}% · ${level.label}`)
      const legend = [{ label: `≤ ${breaks[1].toFixed(0)}`, color: ramp(palette, 0.5 / classes) }]
      for (let i = 1; i < breaks.length - 1; i += 1) {
        legend.push({ label: `${breaks[i].toFixed(0)} – ${breaks[i + 1].toFixed(0)}`, color: ramp(palette, (i + 0.5) / classes) })
      }
      legend.push({ label: `> ${breaks[breaks.length - 2].toFixed(0)}`, color: ramp(palette, 1 - 0.5 / classes) })
      ctx.legend(legend.slice(0, 9))
    }

    const aggregate = (level: GeoLODLevel): void => {
      if (generating) return
      generating = true
      const buffer = generateSyntheticPoints(count, { pattern, seed, categoryCount: 6 })
      const levelIndex = lod.levels.indexOf(level)

      if (algorithm === 'h3') {
        const cells = h3binBuffer(buffer, level.resolution)
        generating = false
        if (!disposed) renderCells(cells, level)
        return
      }

      const param = algorithm === 'hexbin' ? HEX_RADIUS_BY_LEVEL[levelIndex] ?? 0.4 : GRID_SIZE_BY_LEVEL[levelIndex] ?? 0.9
      const end = ctx.profiler.time('Worker')
      aggregateInWorker(
        {
          mode: algorithm === 'hexbin' ? 'hexbin' : 'grid',
          positions: buffer.positions,
          values: buffer.values,
          param,
          lat0: 34
        },
        [buffer.positions.buffer, buffer.values.buffer]
      )
        .then((response) => {
          const workerMs = end()
          generating = false
          if (disposed) return
          ctx.profiler.set('Worker', `${workerMs.toFixed(1)} ms`)
          const isHex = algorithm === 'hexbin'
          const cells: AggregateCell[] = []
          for (let i = 0; i < response.count; i += 1) {
            const lon = response.lon[i]
            const lat = response.lat[i]
            const cellCount = response.cellCounts[i]
            cells.push({
              key: String(i),
              lon,
              lat,
              polygon: isHex ? hexRing(lon, lat, param) : squareRing(lon, lat, param),
              count: cellCount,
              sum: response.sum[i],
              mean: cellCount > 0 ? response.sum[i] / cellCount : 0,
              min: response.min[i],
              max: response.max[i]
            })
          }
          renderCells(cells, level)
        })
        .catch(() => {
          generating = false
        })
    }

    let currentAlgorithm = algorithm
    const refresh = (): void => {
      const level = lod.resolve(ctx.viewer.camera.positionCartographic.height)
      if (level.resolution !== currentLevel.resolution || algorithm !== currentAlgorithm) {
        currentLevel = level
        currentAlgorithm = algorithm
        aggregate(level)
      }
    }

    aggregate(currentLevel)
    ctx.onFrame(refresh)
    ctx.status(`聚合 ${formatCount(count)} 个合成点`)
  }
}

export default spec
