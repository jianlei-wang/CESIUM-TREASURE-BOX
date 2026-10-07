import { Cartesian2, Cartesian3, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium'
import type { D3CaseSpec } from '../types'
import type { GeoPointBuffer } from '../core/buffer'
import { screenLOD } from '../core/lod'
import { buildScreenQuadtree, quadtreeNearest, type ScreenDatum } from '../spatial/quadtree'
import { ramp } from '../palettes'
import { formatCount, normalize } from '../core/geo'
import { loadQuakes } from './_data'
import { PALETTE_OPTIONS, rampLegend } from './_kit'

/** 左下角场景说明面板：把屏幕空间聚合放到真实大屏监控语境里。 */
function scenarioPanel(): { root: HTMLElement; update: (rows: Array<[string, string]>, nearest: string) => void } {
  const root = document.createElement('div')
  root.style.cssText = [
    'position:absolute',
    'left:12px',
    'bottom:64px',
    'width:308px',
    'padding:10px 12px',
    'box-sizing:border-box',
    'border:1px solid rgba(157,188,224,0.28)',
    'border-radius:9px',
    'background:rgba(10,26,52,0.86)',
    'backdrop-filter:blur(6px)',
    'color:#dce8f5',
    'font:11px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif',
    'pointer-events:none'
  ].join(';')
  const head = document.createElement('div')
  head.style.cssText = 'color:#8ea5c2;letter-spacing:.14em;font-size:10px;margin-bottom:5px;padding-bottom:4px;border-bottom:1px solid rgba(157,188,224,0.16)'
  head.textContent = '应用场景 · 大屏事件密度监控'
  const desc = document.createElement('div')
  desc.style.cssText = 'color:#9fb8d4;margin-bottom:6px'
  desc.textContent = '事件按屏幕像素聚合，缩放时密度单元保持稳定，避免海量点逐帧重绘。'
  const stats = document.createElement('div')
  stats.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-variant-numeric:tabular-nums'
  const query = document.createElement('div')
  query.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px solid rgba(157,188,224,0.16);color:#fbbf24'
  query.textContent = '点击地图任意位置查询最近单元'
  root.append(head, desc, stats, query)

  const update = (rows: Array<[string, string]>, nearest: string): void => {
    stats.replaceChildren(
      ...rows.flatMap(([key, value]) => {
        const k = document.createElement('span')
        k.style.cssText = 'color:#8ea5c2'
        k.textContent = key
        const v = document.createElement('span')
        v.style.cssText = 'color:#9fc3ff'
        v.textContent = value
        return [k, v]
      })
    )
    query.textContent = nearest
  }
  return { root, update }
}

const spec: D3CaseSpec = {
  id: 'd3-screen-grid',
  meta: {
    title: '动态屏幕网格 · 像素尺度聚合',
    subtitle: '真实事件 → 屏幕网格 → Quadtree 最近邻',
    description:
      '按屏幕像素而非固定经纬度确定聚合尺度，随相机高度在 12–64px 单元间切换；聚合结果绘制在画布叠加层，d3-quadtree 提供最近邻查询，更符合 WebGIS 大数据可视化的实际需求。',
    tag: 'Screen Grid · Quadtree · 像素尺度',
    accent: '#38bdf8',
    tips: [
      '聚合单元由屏幕像素决定，而非固定经纬网',
      '相机高度通过统一 screenLOD 映射到 12–64px 单元',
      'd3-quadtree 为聚合中心建立空间索引，点击查询最近单元'
    ]
  },
  defaults: {
    cellScale: 1,
    palette: 'inferno',
    opacity: 0.82,
    showPoints: false
  },
  camera: { lon: 20, lat: 20, height: 16_000_000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'cellScale', label: '单元缩放', min: 0.5, max: 3, step: 0.25 },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS },
    { kind: 'range', key: 'opacity', label: '不透明度', min: 0.2, max: 1, step: 0.05 },
    { kind: 'checkbox', key: 'showPoints', label: '显示原始点' }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const palette = String(settings.palette)
    let disposed = false
    let buffer: GeoPointBuffer | undefined
    let tree: ReturnType<typeof buildScreenQuadtree> | undefined
    let cellCenters: ScreenDatum[] = []
    let selected: { x: number; y: number; count: number } | undefined
    let lastUpdate = 0

    const canvas = document.createElement('canvas')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    ctx.overlay(canvas)

    const panel = scenarioPanel()
    ctx.overlay(panel.root)

    const handler = new ScreenSpaceEventHandler(ctx.viewer.scene.canvas)
    ctx.onCleanup(() => {
      disposed = true
      handler.destroy()
    })

    handler.setInputAction((movement: { position: Cartesian2 }) => {
      if (!tree) return
      const nearest = quadtreeNearest(tree, movement.position.x, movement.position.y)
      if (!nearest) return
      selected = { x: nearest.x, y: nearest.y, count: nearest.index }
      draw()
    }, ScreenSpaceEventType.LEFT_CLICK)

    const draw = (): void => {
      if (!buffer) return
      const container = ctx.viewer.container
      const width = container.clientWidth
      const height = container.clientHeight
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      const ctx2d = canvas.getContext('2d')
      if (!ctx2d) return
      ctx2d.clearRect(0, 0, width, height)

      const lod = screenLOD.resolve(ctx.viewer.camera.positionCartographic.height)
      const cellSize = Math.max(4, lod.resolution * Number(settings.cellScale))
      const buckets = new Map<string, { x: number; y: number; count: number }>()
      let projected = 0

      for (let i = 0; i < buffer.length; i += 1) {
        const screen = ctx.viewer.scene.cartesianToCanvasCoordinates(Cartesian3.fromDegrees(buffer.positions[i * 2], buffer.positions[i * 2 + 1], 0))
        if (!screen) continue
        projected += 1
        const gx = Math.floor(screen.x / cellSize)
        const gy = Math.floor(screen.y / cellSize)
        const key = `${gx},${gy}`
        const bucket = buckets.get(key)
        if (bucket) bucket.count += 1
        else buckets.set(key, { x: gx * cellSize + cellSize / 2, y: gy * cellSize + cellSize / 2, count: 1 })
      }

      let maxCount = 1
      for (const bucket of buckets.values()) maxCount = Math.max(maxCount, bucket.count)
      ctx2d.globalAlpha = Number(settings.opacity)
      cellCenters = []
      buckets.forEach((bucket) => {
        const t = Math.pow(normalize(bucket.count, 1, maxCount), 0.5)
        const x = bucket.x - cellSize / 2
        const y = bucket.y - cellSize / 2
        ctx2d.fillStyle = ramp(palette, t)
        ctx2d.fillRect(x, y, cellSize - 1, cellSize - 1)
        cellCenters.push({ index: bucket.count, x: bucket.x, y: bucket.y })
      })
      ctx2d.globalAlpha = 1
      ctx2d.strokeStyle = 'rgba(8,15,30,0.5)'
      ctx2d.lineWidth = 1
      buckets.forEach((bucket) => {
        ctx2d.strokeRect(bucket.x - cellSize / 2, bucket.y - cellSize / 2, cellSize - 1, cellSize - 1)
      })
      tree = buildScreenQuadtree(cellCenters)

      if (selected) {
        ctx2d.strokeStyle = '#fbbf24'
        ctx2d.lineWidth = 2
        ctx2d.strokeRect(selected.x - cellSize / 2 - 1, selected.y - cellSize / 2 - 1, cellSize + 1, cellSize + 1)
      }

      if (Boolean(settings.showPoints)) {
        ctx2d.globalAlpha = 1
        ctx2d.fillStyle = 'rgba(226,240,255,0.95)'
        for (let i = 0; i < buffer.length; i += 1) {
          const screen = ctx.viewer.scene.cartesianToCanvasCoordinates(Cartesian3.fromDegrees(buffer.positions[i * 2], buffer.positions[i * 2 + 1], 0))
          if (!screen) continue
          ctx2d.fillRect(screen.x - 1, screen.y - 1, 2, 2)
        }
      }

      const compression = `${((1 - buckets.size / Math.max(1, projected)) * 100).toFixed(1)}%`
      ctx.profiler.set('Input', formatCount(buffer.length))
      ctx.profiler.set('Visible', formatCount(projected))
      ctx.profiler.set('Cells', formatCount(buckets.size))
      ctx.profiler.set('Compression', compression)
      ctx.profiler.set('LOD', lod.label)
      ctx.profiler.set('Cell', `${cellSize.toFixed(0)} px`)
      ctx.profiler.set('Max/Cell', formatCount(maxCount))
      ctx.profiler.set('QuadTree', formatCount(cellCenters.length))
      panel.update(
        [
          ['LOD', lod.label],
          ['单元', `${cellSize.toFixed(0)} px`],
          ['可见点', formatCount(projected)],
          ['聚合单元', formatCount(buckets.size)],
          ['压缩率', compression],
          ['最大单元', formatCount(maxCount)]
        ],
        selected
          ? `最近单元 (${selected.x.toFixed(0)}, ${selected.y.toFixed(0)}) · 含 ${selected.count} 点`
          : '点击地图任意位置查询最近单元'
      )
    }

    const loop = (time: number): void => {
      if (disposed) return
      if (time - lastUpdate > 140) {
        lastUpdate = time
        draw()
      }
    }

    ctx.status('加载真实地震事件…')
    loadQuakes()
      .then((loaded) => {
        if (disposed) return
        buffer = loaded
        draw()
        ctx.onFrame(loop)
        ctx.status(`${formatCount(buffer.length)} 个真实事件 · 屏幕网格聚合 · 点击查询最近单元`)
        ctx.legend([rampLegend(palette, '单元点数 少→多')])
      })
      .catch((error: unknown) => {
        if (!disposed) ctx.status(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }
}

export default spec
