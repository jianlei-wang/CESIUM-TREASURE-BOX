import { Cartesian2, Cartesian3, Color, ScreenSpaceEventHandler, ScreenSpaceEventType, type PointPrimitiveCollection } from 'cesium'
import { scaleLinear, scaleTime } from 'd3'
import type { D3CaseSpec } from '../types'
import type { GeoPointBuffer } from '../core/buffer'
import { screenGridCluster } from '../spatial/quadtree'
import { ramp } from '../palettes'
import { formatCount, normalize } from '../core/geo'
import { addLabel, addPoint, addPolyline } from '../render'
import { loadQuakes } from './_data'
import { PALETTE_OPTIONS, rampLegend } from './_kit'

type Cluster = { index: number; lon: number; lat: number; members: number[]; mean: number; min: number; max: number }
type MemberDatum = { index: number; lon: number; lat: number; mag: number; time: number }

const SVG_NS = 'http://www.w3.org/2000/svg'
/** 单次展开成像的显著成员上限，避免世界视图下超大聚合不可读。 */
const RING_MAX = 60
let clearActive: (() => void) | undefined

const spec: D3CaseSpec = {
  id: 'd3-cluster-spiderfy',
  meta: {
    title: '聚类 + 蜘蛛展开 · 屏幕空间交互',
    subtitle: '真实事件 → 屏幕网格聚类 → 点击展开震群序列',
    description:
      '对 USGS 真实地震事件做屏幕空间网格聚类；点击聚合点自动缩放到该区域，并将内部成员按发震时刻排成时间盘、以颜色表达时序、以大小表达震级，主震高亮，配合震级—时间曲线面板完成一次震群 / 余震序列分析。',
    tag: 'Cluster · Spiderfy · 序列分析',
    accent: '#34d399',
    tips: [
      '输入为真实地震事件坐标与发震时刻，聚类尺度随屏幕像素变化',
      '点击聚合点：自动缩放 + 按时间排布成员，颜色=时序、大小=震级',
      '展开后进入震群序列分析：主震高亮 + 震级/时间曲线 + 序列统计'
    ]
  },
  defaults: {
    cellSize: 46,
    palette: 'turbo',
    spread: 0.35,
    showMembers: true
  },
  camera: { lon: 20, lat: 20, height: 24_000_000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'cellSize', label: '聚合像素', min: 16, max: 120, step: 2 },
    { kind: 'range', key: 'spread', label: '展开半径(度)', min: 0.05, max: 1.5, step: 0.05 },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS },
    { kind: 'checkbox', key: 'showMembers', label: '显示展开成员' },
    { kind: 'button', label: '清除展开', onClick: () => clearActive?.() }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const palette = String(settings.palette)
    let disposed = false
    let buffer: GeoPointBuffer | undefined
    let clusters: Cluster[] = []
    let activeCluster: Cluster | undefined
    let sequenceEl: HTMLElement | undefined
    const collection: PointPrimitiveCollection = ctx.pointCollection()
    const memberCollection: PointPrimitiveCollection = ctx.pointCollection()
    let lastCameraHeight = -1
    let lastCameraLon = 999
    let lastCameraLat = 999

    const handler = new ScreenSpaceEventHandler(ctx.viewer.scene.canvas)
    ctx.onCleanup(() => {
      disposed = true
      clearActive = undefined
      handler.destroy()
    })

    const project = (lon: number, lat: number): Cartesian2 | undefined =>
      ctx.viewer.scene.cartesianToCanvasCoordinates(Cartesian3.fromDegrees(lon, lat, 0))

    const drawClusters = (): void => {
      collection.removeAll()
      const maxCluster = clusters.reduce((acc, cluster) => Math.max(acc, cluster.members.length), 1)
      for (const cluster of clusters) {
        const t = normalize(cluster.members.length, 1, maxCluster)
        const size = 6 + Math.sqrt(cluster.members.length) * 3.4
        collection.add({
          position: Cartesian3.fromDegrees(cluster.lon, cluster.lat, 0),
          color: cssColor(ramp(palette, Math.pow(t, 0.5)), 0.92),
          pixelSize: Math.min(30, size),
          outlineColor: cssColor('#0f172a', 1),
          outlineWidth: 1,
          id: { __d3cluster: cluster.index }
        })
      }
    }

    /** 自动缩放到聚合区域，使展开放大后可见。 */
    const zoomToCluster = (cluster: Cluster): void => {
      const spread = Number(settings.spread)
      const ground = Math.max(0.2, 2 * spread) * 111_320
      const height = Math.min(2_000_000, Math.max(40_000, ground / 0.46))
      ctx.viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(cluster.lon, cluster.lat, height),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        duration: 1.2
      })
    }

    /**
     * 应用场景：震群序列分析。
     * 成员按发震时刻排成时间盘（颜色=时序、大小=震级），对角线内连线为序列路径，
     * 主震高亮，并弹出震级—时间曲线与统计面板。
     */
    const spiderfy = (cluster: Cluster): void => {
      const buf = buffer
      if (!buf) return
      activeCluster = cluster
      memberCollection.removeAll()
      ctx.dataSource.entities.removeAll()
      if (sequenceEl) {
        sequenceEl.remove()
        sequenceEl = undefined
      }

      const allMembers: MemberDatum[] = cluster.members
        .map((index) => ({
          index,
          lon: buf.positions[index * 2],
          lat: buf.positions[index * 2 + 1],
          mag: buf.values[index],
          time: buf.timestamps[index]
        }))
        .sort((a, b) => a.time - b.time)
      const total = allMembers.length
      const span = total > 1 ? allMembers[total - 1].time - allMembers[0].time : 0
      // 世界视图下单个聚合可能含上千条记录，取震级最大的显著成员成像，保证序列盘可读。
      const members =
        total > RING_MAX
          ? [...allMembers]
              .sort((a, b) => b.mag - a.mag)
              .slice(0, RING_MAX)
              .sort((a, b) => a.time - b.time)
          : allMembers
      const n = members.length
      const main = allMembers.reduce((a, b) => (b.mag > a.mag ? b : a))
      const magRange = extent(allMembers.map((member) => member.mag))

      const spread = Number(settings.spread)
      const points = members.map((_member, k) => {
        const angle = n > 1 ? (Math.PI * 2 * k) / n - Math.PI / 2 : 0
        return { lon: cluster.lon + Math.cos(angle) * spread, lat: cluster.lat + Math.sin(angle) * spread * 0.7 }
      })

      if (Boolean(settings.showMembers) && n > 0) {
        const magRange = extent(members.map((member) => member.mag))
        for (let k = 0; k < n; k += 1) {
          const magT = normalize(members[k].mag, magRange[0], magRange[1])
          memberCollection.add({
            position: Cartesian3.fromDegrees(points[k].lon, points[k].lat, 0),
            color: cssColor(ramp(palette, n > 1 ? k / (n - 1) : 0.5), 0.95),
            pixelSize: 4 + magT * 8,
            outlineColor: cssColor('#0f172a', 0.9),
            outlineWidth: 1,
            id: { __d3member: members[k].index }
          })
        }
        // 序列路径：按时间顺序连接成员
        for (let k = 0; k < n - 1; k += 1) {
          addPolyline(
            ctx.dataSource,
            [
              [points[k].lon, points[k].lat],
              [points[k + 1].lon, points[k + 1].lat]
            ],
            { width: 1.4, color: ramp(palette, k / (n - 1)), alpha: 0.85 }
          )
        }
        if (n > 1) {
          addLabel(ctx.dataSource, points[0].lon, points[0].lat, '起', { color: '#93c5fd', pixelOffsetY: -12 })
          addLabel(ctx.dataSource, points[n - 1].lon, points[n - 1].lat, '末', { color: '#fca5a5', pixelOffsetY: -12 })
        }
        const mainIndex = Math.max(0, members.indexOf(main))
        addPoint(ctx.dataSource, points[mainIndex].lon, points[mainIndex].lat, {
          pixelSize: 12,
          color: '#fef08a',
          outlineColor: '#7c2d12',
          outlineWidth: 2,
          disableDepthTest: true
        })
        addLabel(ctx.dataSource, points[mainIndex].lon, points[mainIndex].lat, `主震 M${main.mag.toFixed(1)}`, { color: '#fde68a', pixelOffsetY: -20 })
      }

      zoomToCluster(cluster)

      if (Boolean(settings.showMembers) && n > 1) {
        sequenceEl = sequencePanel(members, palette, {
          total,
          start: allMembers[0].time,
          span,
          magMin: magRange[0],
          magMax: magRange[1]
        })
        ctx.overlay(sequenceEl)
      }

      const shown = n < total ? `展示 ${formatCount(n)} / ` : ''
      ctx.legend([rampLegend(palette, '序列时序 早→晚')])
      ctx.status(
        `震群序列 · ${shown}共 ${formatCount(total)} 事件 · 主震 M${magRange[1].toFixed(1)} · 跨度 ${formatDuration(span)} · 均值 ${cluster.mean.toFixed(2)}`
      )
    }

    const clearExpansion = (): void => {
      activeCluster = undefined
      memberCollection.removeAll()
      ctx.dataSource.entities.removeAll()
      if (sequenceEl) {
        sequenceEl.remove()
        sequenceEl = undefined
      }
      computeClusters()
      ctx.legend([rampLegend(palette, '聚合数量 少→多')])
      if (buffer) ctx.status(`${formatCount(buffer.length)} 个真实事件 → ${formatCount(clusters.length)} 个聚合点，点击聚合点展开`)
    }
    clearActive = clearExpansion

    const computeClusters = (): void => {
      if (!buffer) return
      const xs = new Float32Array(buffer.length)
      const ys = new Float32Array(buffer.length)
      const valid: number[] = []
      for (let i = 0; i < buffer.length; i += 1) {
        const screen = project(buffer.positions[i * 2], buffer.positions[i * 2 + 1])
        if (!screen) continue
        xs[i] = screen.x
        ys[i] = screen.y
        valid.push(i)
      }
      const { assignments } = screenGridCluster(xs, ys, Number(settings.cellSize))
      const buckets = new Map<number, number[]>()
      for (const i of valid) {
        const id = assignments[i]
        if (id < 0) continue
        const list = buckets.get(id)
        if (list) list.push(i)
        else buckets.set(id, [i])
      }
      clusters = []
      let ci = 0
      for (const members of buckets.values()) {
        let lon = 0
        let lat = 0
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY
        let sum = 0
        for (const i of members) {
          lon += buffer.positions[i * 2]
          lat += buffer.positions[i * 2 + 1]
          const value = buffer.values[i]
          sum += value
          if (value < min) min = value
          if (value > max) max = value
        }
        clusters.push({ index: ci, lon: lon / members.length, lat: lat / members.length, members, mean: sum / members.length, min, max })
        ci += 1
      }
      drawClusters()
    }

    handler.setInputAction((movement: { position: Cartesian2 }) => {
      if (!buffer) return
      const picked = ctx.viewer.scene.pick(movement.position) as { id?: { __d3cluster?: number } } | undefined
      const clusterId = picked?.id?.__d3cluster
      if (clusterId === undefined) return
      const cluster = clusters[clusterId]
      if (cluster) spiderfy(cluster)
    }, ScreenSpaceEventType.LEFT_CLICK)

    const refreshIfCameraMoved = (): void => {
      if (!buffer || activeCluster) return
      const carto = ctx.viewer.camera.positionCartographic
      const height = carto.height
      const lon = (carto.longitude * 180) / Math.PI
      const lat = (carto.latitude * 180) / Math.PI
      if (
        Math.abs(height - lastCameraHeight) > Math.max(1, height * 0.04) ||
        Math.abs(lon - lastCameraLon) > 0.4 ||
        Math.abs(lat - lastCameraLat) > 0.4
      ) {
        lastCameraHeight = height
        lastCameraLon = lon
        lastCameraLat = lat
        computeClusters()
      }
    }

    ctx.status('加载真实地震事件…')
    loadQuakes()
      .then((loaded) => {
        if (disposed) return
        buffer = loaded
        const start = ctx.profiler.time('Cluster')
        computeClusters()
        ctx.profiler.set('Cluster', `${start().toFixed(0)} ms`)
        ctx.profiler.set('Input', formatCount(buffer.length))
        ctx.profiler.set('Clusters', formatCount(clusters.length))
        ctx.profiler.set('Compression', `${((1 - clusters.length / buffer.length) * 100).toFixed(1)}%`)
        ctx.status(`${formatCount(buffer.length)} 个真实事件 → ${formatCount(clusters.length)} 个聚合点，点击聚合点展开`)
        ctx.legend([rampLegend(palette, '聚合数量 少→多')])
        ctx.onFrame(refreshIfCameraMoved)
      })
      .catch((error: unknown) => {
        if (!disposed) ctx.status(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }
}

function cssColor(css: string, alpha: number): Color {
  const color = Color.fromCssColorString(css)
  color.alpha = alpha
  return color
}

/** 震群序列分析面板：震级—时间曲线 + 序列统计。 */
function sequencePanel(
  members: MemberDatum[],
  palette: string,
  summary: { total: number; start: number; span: number; magMin: number; magMax: number }
): HTMLElement {
  const n = members.length
  const el = document.createElement('div')
  el.style.cssText =
    'position:absolute;left:12px;bottom:64px;width:348px;padding:10px 12px;box-sizing:border-box;border:1px solid rgba(157,188,224,0.28);border-radius:9px;background:rgba(10,26,52,0.86);backdrop-filter:blur(6px);color:#dce8f5;font:11px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif'
  const head = document.createElement('div')
  head.textContent = '震群序列分析 · MAGNITUDE / TIME'
  head.style.cssText = 'color:#8ea5c2;letter-spacing:.14em;font-size:10px;margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid rgba(157,188,224,0.16)'
  el.appendChild(head)

  const W = 324
  const H = 104
  const padL = 30
  const padR = 8
  const padT = 8
  const padB = 18
  const mags = members.map((member) => member.mag)
  const magRange = extent(mags)
  const t0 = summary.start
  const span = Math.max(1, summary.span)
  const x = scaleTime().domain([t0, t0 + span]).range([padL, W - padR])
  const y = scaleLinear().domain([magRange[0] - 0.1, magRange[1] + 0.1]).range([H - padB, padT])

  const svg = svgNode('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` })
  for (let i = 0; i < 3; i += 1) {
    const value = magRange[0] + ((magRange[1] - magRange[0]) * i) / 2
    const gy = Number(y(value))
    svg.appendChild(svgNode('line', { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: 'rgba(157,188,224,0.14)', 'stroke-width': 1 }))
    const tick = svgNode('text', { x: padL - 5, y: gy + 3, fill: '#8ea5c2', 'font-size': 8, 'text-anchor': 'end' })
    tick.textContent = value.toFixed(1)
    svg.appendChild(tick)
  }

  const path = members
    .map((member, i) => `${i === 0 ? 'M' : 'L'}${Number(x(member.time)).toFixed(1)},${Number(y(member.mag)).toFixed(1)}`)
    .join(' ')
  svg.appendChild(svgNode('path', { d: path, fill: 'none', stroke: 'rgba(148,163,184,0.55)', 'stroke-width': 1 }))

  const main = members.reduce((a, b) => (b.mag > a.mag ? b : a))
  members.forEach((member, i) => {
    const isMain = member === main
    svg.appendChild(
      svgNode('circle', {
        cx: Number(x(member.time)),
        cy: Number(y(member.mag)),
        r: isMain ? 4.4 : 2.4,
        fill: isMain ? '#fef08a' : ramp(palette, n > 1 ? i / (n - 1) : 0.5),
        stroke: isMain ? '#7c2d12' : 'none',
        'stroke-width': isMain ? 1.2 : 0
      })
    )
  })
  el.appendChild(svg)

  const stats = document.createElement('div')
  stats.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px solid rgba(157,188,224,0.16)'
  const rows: Array<[string, string]> = [
    ['事件总数', formatCount(summary.total)],
    ...(summary.total > n ? ([['展示成员', `${n} 显著`]] as Array<[string, string]>) : []),
    ['主震', `M${summary.magMax.toFixed(1)} · ${stamp(main.time)}`],
    ['序列跨度', formatDuration(span)],
    ['平均间隔', summary.total > 1 ? formatDuration(span / (summary.total - 1)) : '—'],
    ['震级范围', `${summary.magMin.toFixed(1)} – ${summary.magMax.toFixed(1)}`]
  ]
  stats.innerHTML = rows
    .map(
      ([key, value]) =>
        `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#8ea5c2">${key}</span><span style="color:#9fc3ff;font-variant-numeric:tabular-nums">${value}</span></div>`
    )
    .join('')
  el.appendChild(stats)
  return el
}

function svgNode(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  return node
}

function extent(values: number[]): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return [min, max]
}

function stamp(time: number): string {
  const date = new Date(time)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 分钟'
  const minutes = ms / 60_000
  if (minutes < 60) return `${minutes.toFixed(0)} 分钟`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(1)} 小时`
  return `${(hours / 24).toFixed(1)} 天`
}

export default spec
