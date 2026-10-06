import { scaleLinear, extent } from 'd3'
import type { D3CaseSpec } from '../types'
import { CHINA_CITIES } from '../data'
import { ramp } from '../palettes'
import { addCylinder, addLabel, addPoint } from '../render'

const spec: D3CaseSpec = {
  id: 'd3-bar-globe',
  meta: {
    title: '三维棱柱柱状图',
    subtitle: 'd3.scaleLinear → Cesium CylinderGraphics 拔地而起',
    description: '把城市指标映射为柱高与颜色，在三维地球上形成可旋转观察的 Bar Globe。',
    tag: 'D3 统计图形 · 3D 柱状',
    accent: '#22d3ee',
    tips: [
      'd3.scaleLinear 把指标值域映射到柱高与半径，实现「数据即样式」',
      '逐城市生成 Cesium 圆柱实体，天然支持旋转、缩放与遮挡关系',
      '色带由 d3 连续比例尺驱动，切换色带整图同步重算'
    ]
  },
  defaults: {
    heightScale: 260000,
    radius: 16000,
    ramp: 'turbo',
    showLabels: true,
    sortAsc: false
  },
  camera: { lon: 104, lat: 34, height: 5200000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'heightScale', label: '柱高倍率', min: 40000, max: 600000, step: 20000 },
    { kind: 'range', key: 'radius', label: '柱半径', min: 6000, max: 40000, step: 1000 },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'turbo', label: 'turbo' },
        { value: 'viridis', label: 'viridis' },
        { value: 'spectral', label: 'spectral' },
        { value: 'sunset', label: 'sunset' }
      ]
    },
    { kind: 'checkbox', key: 'showLabels', label: '显示城市标签' },
    { kind: 'checkbox', key: 'sortAsc', label: '升序着色' }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const heightScale = Number(settings.heightScale)
    const radius = Number(settings.radius)
    const palette = String(settings.ramp)
    const showLabels = Boolean(settings.showLabels)
    const sortAsc = Boolean(settings.sortAsc)

    const values = CHINA_CITIES.map((c) => c.value)
    const [min, max] = extent(values) as [number, number]
    const height = scaleLinear([min, max], [0.12, 1])

    const cities = [...CHINA_CITIES].sort((a, b) => b.value - a.value)
    cities.forEach((city, rank) => {
      const ratio = height(city.value) ?? 0.2
      const color = ramp(palette, sortAsc ? ratio : 1 - ratio)
      addCylinder(ctx.dataSource, city.lon, city.lat, {
        radius: radius * (0.7 + ratio * 0.6),
        height: Math.max(4000, ratio * heightScale),
        color,
        alpha: 0.92,
        outline: true,
        outlineColor: '#0f172a'
      })
      addPoint(ctx.dataSource, city.lon, city.lat, { pixelSize: 4, color: '#f8fafc', disableDepthTest: true })
      if (showLabels) {
        addLabel(ctx.dataSource, city.lon, city.lat, `${city.name} ${city.value}`, {
          font: '12px sans-serif',
          scaleByDistance: [800000, 0.35, 6000000, 1.3],
          disableDepthTest: true
        })
      }
    })

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `指标 ${min} ~ ${max}`, color: ramp(palette, 0) }
    ])
    ctx.status(`共 ${cities.length} 个城市柱体，最高 ${cities[0]?.name ?? ''}（${cities[0]?.value ?? 0}）`)
  }
}

export default spec
