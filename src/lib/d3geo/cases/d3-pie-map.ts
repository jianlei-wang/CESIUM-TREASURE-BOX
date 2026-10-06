import { pie } from 'd3'
import type { D3CaseSpec } from '../types'
import { CHINA_CITIES, mulberry32 } from '../data'
import { categorical } from '../palettes'
import { addLabel, addPolygon, type LonLat } from '../render'

const INDUSTRIES = ['制造', '服务', '科技', '金融', '其他']
const PIE_CITIES = CHINA_CITIES.slice(0, 8)

/** 在 (lon,lat) 局部平面上生成一个环形扇区，再换算回经纬度。 */
function donutSector(
  lon: number,
  lat: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): LonLat[] {
  const latRad = (lat * Math.PI) / 180
  const metersPerLon = 111320 * (Math.cos(latRad) || 0.01)
  const metersPerLat = 110540
  const segments = Math.max(2, Math.ceil((endAngle - startAngle) / (Math.PI / 24)))
  const points: LonLat[] = []

  for (let i = 0; i <= segments; i += 1) {
    const angle = startAngle + ((endAngle - startAngle) * i) / segments
    const x = Math.cos(angle) * outerRadius
    const y = Math.sin(angle) * outerRadius
    points.push([lon + x / metersPerLon, lat + y / metersPerLat])
  }
  for (let i = segments; i >= 0; i -= 1) {
    const angle = startAngle + ((endAngle - startAngle) * i) / segments
    const x = Math.cos(angle) * innerRadius
    const y = Math.sin(angle) * innerRadius
    points.push([lon + x / metersPerLon, lat + y / metersPerLat])
  }
  return points
}

const spec: D3CaseSpec = {
  id: 'd3-pie-map',
  meta: {
    title: '地理环形图组合',
    subtitle: 'd3.pie → 扇形顶点 → Cesium 拉伸甜甜圈',
    description: '为每座城市计算多产业占比的扇形角度，在局部平面生成顶点后抬升为悬浮甜甜圈。',
    tag: 'D3 饼图 · 空间组合',
    accent: '#f472b6',
    tips: [
      'd3.pie 只负责算角度，环形顶点需在局部平面用极坐标生成再换算为经纬度',
      '内半径打开形成甜甜圈，挤出厚度后悬浮于城市上空，避免与地表相互遮挡',
      '每个城市共享同一套产业色板，快速横向比较产业结构的差异'
    ]
  },
  defaults: {
    outerRadius: 170000,
    innerRadius: 0.5,
    thickness: 60000,
    baseLift: 40000,
    showLabels: true,
    seed: 20261006
  },
  camera: { lon: 108, lat: 31, height: 6200000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'outerRadius', label: '外半径(m)', min: 60000, max: 260000, step: 10000, format: (v) => `${Math.round(v / 1000)}km` },
    { kind: 'range', key: 'innerRadius', label: '内径比例', min: 0.2, max: 0.8, step: 0.05 },
    { kind: 'range', key: 'thickness', label: '环体厚度(m)', min: 10000, max: 120000, step: 10000, format: (v) => `${Math.round(v / 1000)}km` },
    { kind: 'range', key: 'baseLift', label: '悬浮高度(m)', min: 0, max: 400000, step: 20000, format: (v) => `${Math.round(v / 1000)}km` },
    { kind: 'checkbox', key: 'showLabels', label: '显示城市标签' },
    { kind: 'range', key: 'seed', label: '数据种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const outer = Number(settings.outerRadius)
    const innerRatio = Number(settings.innerRadius)
    const thickness = Number(settings.thickness)
    const baseLift = Number(settings.baseLift)
    const showLabels = Boolean(settings.showLabels)
    const seed = Number(settings.seed)

    const inner = outer * innerRatio
    const rng = mulberry32(seed)

    PIE_CITIES.forEach((city) => {
      const values = INDUSTRIES.map(() => 20 + rng() * 80)
      const total = values.reduce((acc, value) => acc + value, 0)
      const arcs = pie()
        .value((d: number) => d)
        .sort(null)
        .padAngle(0.04)(values) as Array<{ startAngle: number; endAngle: number; index: number }>

      arcs.forEach((slice) => {
        const points = donutSector(city.lon, city.lat, inner, outer, slice.startAngle, slice.endAngle)
        addPolygon(ctx.dataSource, points, {
          height: 200 + baseLift,
          extrudedHeight: 200 + baseLift + thickness,
          color: categorical(slice.index),
          alpha: 0.9,
          outline: true,
          outlineColor: '#0f172a',
          outlineWidth: 1
        })
      })

      if (showLabels) {
        addLabel(ctx.dataSource, city.lon, city.lat, `${city.name} ${Math.round(total)}`, {
          font: '12px sans-serif',
          disableDepthTest: true,
          scaleByDistance: [1000000, 0.5, 8000000, 1.3]
        })
      }
    })

    ctx.legend(
      INDUSTRIES.map((name, index) => ({ label: name, color: categorical(index) }))
    )
    ctx.status(
      `${PIE_CITIES.length} 座城市 × ${INDUSTRIES.length} 产业，外径 ${Math.round(outer / 1000)}km / 内径比 ${innerRatio}`
    )
  }
}

export default spec
