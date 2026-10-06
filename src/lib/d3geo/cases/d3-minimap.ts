import { geoGraticule, geoMercator, geoPath, select } from 'd3'
import { Cartesian3, Math as CesiumMath } from 'cesium'
import type { D3CaseSpec } from '../types'
import { CHINA_CITIES } from '../data'

const SVG_NS = 'http://www.w3.org/2000/svg'
const REGION_BOUNDS = { west: 73, south: 18, east: 135, north: 54 }
const REGION = {
  type: 'Polygon',
  coordinates: [
    [
      [REGION_BOUNDS.west, REGION_BOUNDS.south],
      [REGION_BOUNDS.east, REGION_BOUNDS.south],
      [REGION_BOUNDS.east, REGION_BOUNDS.north],
      [REGION_BOUNDS.west, REGION_BOUNDS.north],
      [REGION_BOUNDS.west, REGION_BOUNDS.south]
    ]
  ]
}

const spec: D3CaseSpec = {
  id: 'd3-minimap',
  meta: {
    title: '总览 + 细节双视图联动',
    subtitle: 'd3.geoPath / geoGraticule 小地图 → computeViewRectangle 同步',
    description: '左上角用 d3 绘制区域底图与当前主视图范围框，点击小地图即可把主相机移动到该处。',
    tag: 'D3 投影 · 双视图联动',
    accent: '#4ade80',
    tips: [
      'd3.geoMercator 投影把经纬底图渲染到小尺寸 SVG，geoGraticule 生成经纬网',
      '每帧主视图范围通过 camera.computeViewRectangle 读取，投影后画成小地图上的矩形框',
      'camera.changed 事件驱动同步，监听在 onCleanup 中移除，避免重建后泄漏'
    ]
  },
  defaults: {
    size: 240,
    flyDuration: 1.2,
    height: 2200000,
    showGraticule: true,
    showCities: true
  },
  camera: { lon: 104, lat: 34, height: 6200000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'size', label: '小地图宽度', min: 160, max: 340, step: 20 },
    { kind: 'range', key: 'flyDuration', label: '飞行时长(s)', min: 0.3, max: 4, step: 0.1 },
    { kind: 'range', key: 'height', label: '目标高度(m)', min: 500000, max: 8000000, step: 250000 },
    { kind: 'checkbox', key: 'showGraticule', label: '显示经纬网' },
    { kind: 'checkbox', key: 'showCities', label: '显示城市点' }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const width = Number(settings.size)
    const height = Math.round(width * 0.72)
    const flyDuration = Number(settings.flyDuration)
    const targetHeight = Number(settings.height)
    const showGraticule = Boolean(settings.showGraticule)
    const showCities = Boolean(settings.showCities)

    const wrap = document.createElement('div')
    ctx.overlay(wrap)
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.style.cssText =
      'position:absolute;left:16px;top:16px;border-radius:12px;background:rgba(15,23,42,0.86);' +
      'border:1px solid rgba(148,163,184,0.32);pointer-events:auto;cursor:crosshair;'
    wrap.appendChild(svg)

    const projection = geoMercator().fitExtent(
      [
        [8, 8],
        [width - 8, height - 8]
      ],
      REGION
    )
    const path = geoPath(projection)
    const root = select(svg)
    root.selectAll('*').remove()

    root.append('path').attr('d', path(REGION) ?? '').attr('fill', '#1e293b').attr('stroke', '#38bdf8').attr('stroke-width', 1.2)

    if (showGraticule) {
      const graticule = geoGraticule().step([10, 10])()
      root
        .append('path')
        .attr('d', path(graticule) ?? '')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(148,163,184,0.25)')
        .attr('stroke-width', 0.6)
    }

    if (showCities) {
      root
        .selectAll('circle.city')
        .data(CHINA_CITIES)
        .enter()
        .append('circle')
        .attr('class', 'city')
        .attr('cx', (d: { lon: number; lat: number }) => projection([d.lon, d.lat])?.[0] ?? 0)
        .attr('cy', (d: { lon: number; lat: number }) => projection([d.lon, d.lat])?.[1] ?? 0)
        .attr('r', 1.8)
        .attr('fill', '#4ade80')
        .attr('opacity', 0.8)
    }

    const viewRect = root
      .append('rect')
      .attr('fill', 'rgba(56,189,248,0.16)')
      .attr('stroke', '#38bdf8')
      .attr('stroke-width', 1.2)
      .attr('rx', 2)
    const center = root.append('circle').attr('r', 3).attr('fill', '#facc15').attr('stroke', '#0f172a').attr('stroke-width', 1)

    const clampX = (v: number) => Math.max(0, Math.min(width, v))
    const clampY = (v: number) => Math.max(0, Math.min(height, v))

    const sync = () => {
      const rect = ctx.viewer.camera.computeViewRectangle(ctx.viewer.scene.globe.ellipsoid)
      if (!rect) {
        viewRect.attr('opacity', 0)
        center.attr('opacity', 0)
        return
      }
      const west = CesiumMath.toDegrees(rect.west)
      const east = CesiumMath.toDegrees(rect.east)
      const south = CesiumMath.toDegrees(rect.south)
      const north = CesiumMath.toDegrees(rect.north)
      const p1 = projection([west, north])
      const p2 = projection([east, south])
      if (!p1 || !p2) return
      const x0 = clampX(Math.min(p1[0], p2[0]))
      const x1 = clampX(Math.max(p1[0], p2[0]))
      const y0 = clampY(Math.min(p1[1], p2[1]))
      const y1 = clampY(Math.max(p1[1], p2[1]))
      viewRect
        .attr('opacity', 1)
        .attr('x', x0)
        .attr('y', y0)
        .attr('width', Math.max(4, x1 - x0))
        .attr('height', Math.max(4, y1 - y0))
      const cx = clampX((x0 + x1) / 2)
      const cy = clampY((y0 + y1) / 2)
      center.attr('opacity', 1).attr('cx', cx).attr('cy', cy)
    }

    const onCameraChanged = () => sync()
    ctx.viewer.camera.changed.addEventListener(onCameraChanged)
    ctx.onCleanup(() => ctx.viewer.camera.changed.removeEventListener(onCameraChanged))

    const onClick = (event: MouseEvent) => {
      const box = svg.getBoundingClientRect()
      const mx = event.clientX - box.left
      const my = event.clientY - box.top
      const lonLat = projection.invert?.([mx, my])
      if (!lonLat) return
      ctx.viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(lonLat[0], lonLat[1], targetHeight),
        duration: flyDuration
      })
      ctx.status(`主视图飞往 ${lonLat[1].toFixed(2)}N, ${lonLat[0].toFixed(2)}E`)
    }
    svg.addEventListener('click', onClick)
    ctx.onCleanup(() => svg.removeEventListener('click', onClick))

    sync()
    ctx.legend([
      { label: '主视图范围', color: '#38bdf8' },
      { label: '视图中心', color: '#facc15' }
    ])
    ctx.status('小地图实时同步主视图范围，点击小地图可快速定位')
  }
}

export default spec
