import { geoEquirectangular, geoGraticule, geoMercator, geoPath } from 'd3'
import type { D3CaseSpec } from '../types'
import { CHINA_CITIES } from '../data'
import { addPolygon, addToPointCollection, type LonLat } from '../render'

const SVG_NS = 'http://www.w3.org/2000/svg'

const CITIES = CHINA_CITIES.filter((_city: unknown, index: number) => index % 3 === 0).slice(0, 12)

const RING_NAMES = ['北京', '上海', '广州', '成都', '西安']
const RING = RING_NAMES
  .map((name) => CHINA_CITIES.find((city) => city.name === name))
  .filter((city): city is (typeof CHINA_CITIES)[number] => Boolean(city))

const spec: D3CaseSpec = {
  id: 'd3-projection-bridge',
  meta: {
    title: '2D 与 3D 投影坐标桥接',
    subtitle: 'd3.geoMercator / geoEquirectangular · geoPath + Cesium',
    description: '同一组经纬度既投影到 2D 平面，又用 Cesium 上球渲染，浮层 SVG 验证两者完全一致。',
    tag: 'D3 投影 · 坐标桥接',
    accent: '#a78bfa',
    tips: [
      'd3.geoPath 把经纬度投影为平面 SVG 路径，Cesium 则用 Geodetic 坐标上球，二者共享同一数据源',
      'fitExtent 依据城市多点自适应缩放与居中，切换投影只需更换 projection 工厂函数',
      '覆盖层 SVG 默认 pointerEvents=none，不干扰底图鼠标拾取与相机操作'
    ]
  },
  defaults: {
    projection: 'mercator',
    pointHeight: 120000,
    pointSize: 8,
    showGraticule: true,
    showSvg: true,
    svgOpacity: 0.85
  },
  camera: { lon: 104, lat: 34, height: 6000000, pitch: -90 },
  controls: [
    {
      kind: 'select',
      key: 'projection',
      label: '投影方式',
      options: [
        { value: 'mercator', label: 'geoMercator' },
        { value: 'equirectangular', label: 'geoEquirectangular' }
      ]
    },
    { kind: 'range', key: 'pointHeight', label: '点抬升高度', min: 0, max: 600000, step: 20000 },
    { kind: 'range', key: 'pointSize', label: '点尺寸', min: 3, max: 16, step: 1 },
    { kind: 'checkbox', key: 'showGraticule', label: '绘制经纬网' },
    { kind: 'checkbox', key: 'showSvg', label: '叠加 2D 投影浮层' },
    { kind: 'range', key: 'svgOpacity', label: '浮层透明度', min: 0.2, max: 1, step: 0.05 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const projectionName = String(settings.projection)
    const pointHeight = Number(settings.pointHeight)
    const pointSize = Number(settings.pointSize)
    const showGraticule = Boolean(settings.showGraticule)
    const showSvg = Boolean(settings.showSvg)
    const svgOpacity = Number(settings.svgOpacity)

    const collection = ctx.pointCollection()
    CITIES.forEach((city) => {
      addToPointCollection(collection, city.lon, city.lat, pointHeight, '#a78bfa', pointSize)
    })

    const ringPoints = RING.map((city) => [city.lon, city.lat] as LonLat)
    addPolygon(ctx.dataSource, ringPoints, {
      height: 100,
      color: '#38bdf8',
      alpha: 0.28,
      outline: true,
      outlineColor: '#38bdf8',
      outlineWidth: 2
    })

    if (showSvg) {
      const width = 360
      const height = 300
      const pad = 26
      const holder = document.createElement('div')
      holder.style.background = 'rgba(2, 6, 23, 0.72)'
      holder.style.border = '1px solid rgba(148, 163, 184, 0.3)'
      holder.style.borderRadius = '10px'
      holder.style.overflow = 'hidden'
      ctx.overlay(holder)
      holder.style.top = 'auto'
      holder.style.right = 'auto'
      holder.style.bottom = '58px'
      holder.style.left = '16px'
      holder.style.width = `${width}px`
      holder.style.height = `${height}px`

      const svg = document.createElementNS(SVG_NS, 'svg')
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
      svg.setAttribute('width', String(width))
      svg.setAttribute('height', String(height))
      holder.appendChild(svg)

      const projection =
        projectionName === 'equirectangular' ? geoEquirectangular() : geoMercator()
      projection.fitExtent(
        [
          [pad, pad],
          [width - pad, height - pad]
        ],
        { type: 'MultiPoint', coordinates: CITIES.map((city) => [city.lon, city.lat]) }
      )
      const path = geoPath(projection)

      if (showGraticule) {
        const graticulePath = path(geoGraticule().step([10, 10])())
        if (graticulePath) {
          const grat = document.createElementNS(SVG_NS, 'path')
          grat.setAttribute('d', graticulePath)
          grat.setAttribute('fill', 'none')
          grat.setAttribute('stroke', 'rgba(148, 163, 184, 0.35)')
          grat.setAttribute('stroke-width', '0.6')
          grat.setAttribute('opacity', String(svgOpacity))
          svg.appendChild(grat)
        }
      }

      const ringPath = path({ type: 'Polygon', coordinates: [ringPoints] })
      if (ringPath) {
        const outline = document.createElementNS(SVG_NS, 'path')
        outline.setAttribute('d', ringPath)
        outline.setAttribute('fill', 'rgba(56, 189, 248, 0.22)')
        outline.setAttribute('stroke', '#38bdf8')
        outline.setAttribute('stroke-width', '1.4')
        outline.setAttribute('opacity', String(svgOpacity))
        svg.appendChild(outline)
      }

      CITIES.forEach((city) => {
        const xy = projection([city.lon, city.lat]) as [number, number] | null
        if (!xy) return
        const dot = document.createElementNS(SVG_NS, 'circle')
        dot.setAttribute('cx', String(xy[0]))
        dot.setAttribute('cy', String(xy[1]))
        dot.setAttribute('r', '3')
        dot.setAttribute('fill', '#a78bfa')
        dot.setAttribute('opacity', String(svgOpacity))
        svg.appendChild(dot)
      })

      const caption = document.createElementNS(SVG_NS, 'text')
      caption.setAttribute('x', '12')
      caption.setAttribute('y', '20')
      caption.setAttribute('fill', '#7dd3fc')
      caption.setAttribute('font-size', '11')
      caption.textContent = `${projectionName} · geoPath`
      svg.appendChild(caption)
    }

    ctx.legend([
      { label: `${projectionName} 2D 投影`, color: '#a78bfa' },
      { label: `多边形 ${ringPoints.length} 顶点`, color: '#38bdf8' }
    ])
    ctx.status(
      `同一数据双渲染：Cesium 上球 ${CITIES.length} 点 + 1 多边形；浮层 ${projectionName} geoPath 同构`
    )
  }
}

export default spec
