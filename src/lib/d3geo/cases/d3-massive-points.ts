import { Cartesian3, type PointPrimitiveCollection } from 'cesium'
import type { D3CaseSpec } from '../types'
import type { GeoPointBuffer } from '../core/buffer'
import { bufferByteLength, bufferValueExtent } from '../core/buffer'
import { createGeoLOD, createLODScheduler, type GeoLODLevel } from '../core/lod'
import { formatCount } from '../core/geo'
import { generateSyntheticPoints, SYNTHETIC_PATTERNS, SYNTHETIC_SIZES, type SyntheticPattern } from '../data/synthetic'
import { ramp } from '../palettes'
import { renderPointBuffer } from '../render/points'
import { PALETTE_OPTIONS, rampLegend } from './_kit'

const POINT_LOD = createGeoLOD([
  { maxHeight: 500_000, resolution: 250_000, label: 'LOD 6' },
  { maxHeight: 1_500_000, resolution: 200_000, label: 'LOD 5' },
  { maxHeight: 4_000_000, resolution: 150_000, label: 'LOD 4' },
  { maxHeight: 10_000_000, resolution: 110_000, label: 'LOD 3' },
  { maxHeight: 20_000_000, resolution: 70_000, label: 'LOD 2' },
  { maxHeight: Number.POSITIVE_INFINITY, resolution: 40_000, label: 'LOD 1' }
])

function buildPoints(settings: Record<string, unknown>): GeoPointBuffer {
  return generateSyntheticPoints(Number(settings.count), {
    pattern: String(settings.pattern) as SyntheticPattern,
    seed: Number(settings.seed),
    categoryCount: 6
  })
}

const spec: D3CaseSpec = {
  id: 'd3-massive-points',
  meta: {
    title: '百万级地理散点 GPU 可视化',
    subtitle: 'TypedArray + PointPrimitiveCollection + LOD',
    description:
      '以列式 Float32Array 承载十万至千万级地理点，按相机高度动态 LOD 抽稀，经 PointPrimitiveCollection 单批绘制，实时回显渲染对象数与帧率。',
    tag: 'GPU 点图元 · LOD · 性能基准',
    accent: '#22d3ee',
    tips: [
      '数据以 Float32Array 交错存储经纬度，避免 Array<Object> 的海量 GC',
      '海量点走 PointPrimitiveCollection 批量图元，单批 DrawCall',
      '相机高度划分 6 级 LOD，视域越远抽稀越强，渲染对象数动态下降'
    ]
  },
  defaults: {
    count: 500_000,
    pattern: 'clustered',
    palette: 'turbo',
    pointSize: 3.5,
    seed: 20261006
  },
  camera: { lon: 106, lat: 34, height: 7_500_000, pitch: -90 },
  controls: [
    {
      kind: 'select',
      key: 'count',
      label: '数据量',
      options: SYNTHETIC_SIZES.map((size) => ({ value: String(size), label: `${formatCount(size)} points` }))
    },
    { kind: 'select', key: 'pattern', label: '分布模式', options: SYNTHETIC_PATTERNS.slice(0, 4).map((p) => ({ value: p.value, label: p.label })) },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS },
    { kind: 'range', key: 'pointSize', label: '点大小(px)', min: 1, max: 10, step: 0.5 },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const generateEnd = ctx.profiler.time('Generate')
    const buffer = buildPoints(settings as unknown as Record<string, unknown>)
    const generateMs = generateEnd()
    const [minValue, maxValue] = bufferValueExtent(buffer)
    ctx.profiler.set('Input', formatCount(buffer.length))
    ctx.profiler.set('Memory', `${(bufferByteLength(buffer) / 1048576).toFixed(1)} MB`)
    ctx.profiler.set('Generate', `${generateMs.toFixed(1)} ms`)
    ctx.profiler.set('Pattern', String(settings.pattern))
    ctx.status(`${formatCount(buffer.length)} 个合成点 · ${(bufferByteLength(buffer) / 1048576).toFixed(1)} MB`)

    const collection: PointPrimitiveCollection = ctx.pointCollection()

    const render = (level: GeoLODLevel): void => {
      const end = ctx.profiler.time('Render')
      collection.removeAll()
      const result = renderPointBuffer(collection, buffer, {
        mode: 'value',
        palette: String(settings.palette),
        valueDomain: [minValue, maxValue],
        pixelSize: Number(settings.pointSize),
        maxPoints: level.resolution,
        alpha: 0.9
      })
      ctx.profiler.set('Processed', formatCount(result.rendered * result.stride))
      ctx.profiler.set('Rendered', formatCount(result.rendered))
      ctx.profiler.set('GPU Objects', formatCount(result.rendered))
      ctx.profiler.set('LOD', level.label)
      ctx.profiler.set('Compression', `${(((buffer.length - result.rendered) / buffer.length) * 100).toFixed(1)}%`)
      const renderMs = end()
      if (result.stride > 1) {
        ctx.status(`${formatCount(buffer.length)} 输入 · 抽稀 1/${result.stride} · 渲染 ${formatCount(result.rendered)} 点 · ${renderMs.toFixed(1)} ms`)
      }
    }

    const scheduler = createLODScheduler(POINT_LOD, render)
    const initial = POINT_LOD.resolve(ctx.viewer.camera.positionCartographic.height)
    scheduler.markRendered(initial)
    render(initial)

    ctx.onFrame(() => scheduler.frame(ctx.viewer.camera.positionCartographic.height))

    ctx.legend([rampLegend(String(settings.palette), '值 = 低→高'), { label: 'PointPrimitive', color: '#0f172a' }])
    ctx.onCleanup(() => {
      scheduler.dispose()
      collection.removeAll()
    })
  }
}

export default spec
