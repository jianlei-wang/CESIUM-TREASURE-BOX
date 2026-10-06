import { brush, select } from 'd3'
import {
  Cartesian2,
  EasingFunction,
  Math as CesiumMath,
  Rectangle,
  type Entity
} from 'cesium'
import type { D3CaseSpec } from '../types'
import { addPolygon } from '../render'

const SVG_NS = 'http://www.w3.org/2000/svg'

const EASING: Record<string, unknown> = {
  linear: EasingFunction.LINEAR_NONE,
  smooth: EasingFunction.QUADRATIC_IN_OUT,
  cubic: EasingFunction.CUBIC_IN_OUT
}

const spec: D3CaseSpec = {
  id: 'd3-brush-flyto',
  meta: {
    title: '框选-飞行定位',
    subtitle: 'd3.brush 2D 选择 → camera.pickEllipsoid → camera.flyTo',
    description: '在主视图上拖拽画框，将屏幕矩形反投影为经纬范围，相机自动飞行到所选区域。',
    tag: 'D3 交互 · 框选飞行',
    accent: '#f472b6',
    tips: [
      'd3.brush 负责屏幕上的二维框选，结束事件直接给出像素矩形的两个对角点',
      'pickEllipsoid 把像素坐标反算为椭球面经纬度，再拼装 Rectangle 作为飞行目标',
      '全屏 SVG 覆盖层设为 pointerEvents=auto 才能接管鼠标拖拽，其余浮层保持穿透'
    ]
  },
  defaults: {
    duration: 1.6,
    padding: 0.12,
    easing: 'smooth',
    keepShape: true
  },
  camera: { lon: 104, lat: 34, height: 6000000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'duration', label: '飞行时长(s)', min: 0.3, max: 5, step: 0.1 },
    { kind: 'range', key: 'padding', label: '范围外扩', min: 0, max: 0.5, step: 0.02 },
    {
      kind: 'select',
      key: 'easing',
      label: '缓动曲线',
      options: [
        { value: 'smooth', label: '平滑' },
        { value: 'cubic', label: '三次缓动' },
        { value: 'linear', label: '匀速' }
      ]
    },
    { kind: 'checkbox', key: 'keepShape', label: '保留地面框' }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const duration = Number(settings.duration)
    const padding = Number(settings.padding)
    const easing = String(settings.easing)
    const keepShape = Boolean(settings.keepShape)

    const wrap = document.createElement('div')
    ctx.overlay(wrap)
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:auto;cursor:crosshair;'
    wrap.appendChild(svg)

    const toLonLat = (x: number, y: number): { lon: number; lat: number } | null => {
      const cartesian = ctx.viewer.camera.pickEllipsoid(
        new Cartesian2(x, y),
        ctx.viewer.scene.globe.ellipsoid
      )
      if (!cartesian) return null
      const carto = ctx.viewer.scene.globe.ellipsoid.cartesianToCartographic(cartesian)
      return { lon: CesiumMath.toDegrees(carto.longitude), lat: CesiumMath.toDegrees(carto.latitude) }
    }

    let shape: Entity | undefined
    const behavior = brush() as unknown as { extent: (e: number[][]) => unknown; move: unknown; on: (t: string, f: (e: { selection: number[][] | null }) => void) => void }

    const resize = () => {
      const canvas = ctx.viewer.scene.canvas
      const w = canvas.clientWidth || 1
      const h = canvas.clientHeight || 1
      svg.setAttribute('width', String(w))
      svg.setAttribute('height', String(h))
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
      behavior.extent([
        [0, 0],
        [w, h]
      ])
    }
    resize()
    window.addEventListener('resize', resize)
    ctx.onCleanup(() => window.removeEventListener('resize', resize))

    behavior.on('end', (event: { selection: number[][] | null }) => {
      const selection = event.selection
      if (!selection) return
      const [[x0, y0], [x1, y1]] = selection
      if (Math.abs(x1 - x0) < 6 || Math.abs(y1 - y0) < 6) return
      const a = toLonLat(x0, y0)
      const b = toLonLat(x1, y1)
      if (!a || !b) {
        ctx.status('框选区域未命中地球表面，请重新拖拽')
        return
      }
      const west = Math.min(a.lon, b.lon)
      const east = Math.max(a.lon, b.lon)
      const south = Math.min(a.lat, b.lat)
      const north = Math.max(a.lat, b.lat)
      const padLon = (east - west) * padding
      const padLat = (north - south) * padding

      ctx.viewer.camera.flyTo({
        destination: Rectangle.fromDegrees(
          west - padLon,
          south - padLat,
          east + padLon,
          north + padLat
        ),
        duration,
        easingFunction: EASING[easing] as never
      })

      if (keepShape) {
        if (shape) ctx.dataSource.entities.remove(shape)
        shape = addPolygon(
          ctx.dataSource,
          [
            [west - padLon, south - padLat],
            [east + padLon, south - padLat],
            [east + padLon, north + padLat],
            [west - padLon, north + padLat]
          ],
          { height: 60, color: '#f472b6', alpha: 0.18, outline: true, outlineColor: '#f472b6', outlineWidth: 2 }
        )
      }
      ctx.status(
        `框选范围 ${west.toFixed(2)}~${east.toFixed(2)}E / ${south.toFixed(2)}~${north.toFixed(2)}N，飞行 ${duration.toFixed(1)}s`
      )
    })

    select(svg).call(behavior as never)

    ctx.legend([
      { label: '拖拽框选', color: '#f472b6' },
      { label: '飞行目标范围', color: '#38bdf8' }
    ])
    ctx.status('在地图上按住左键拖拽一个矩形，松开后相机飞行到该范围')
  }
}

export default spec
