import { max } from 'd3'
import type { D3CaseSpec } from '../types'
import { CHINA_CITIES, clamp, type CityDatum } from '../data'
import { ramp } from '../palettes'
import { addBox, addLabel } from '../render'

const GEO = { west: 80, east: 135, north: 50, south: 18 }

type Placement = { city: CityDatum; col: number; row: number }

/** 尝试按经纬度把区域放入规则网格；失败时返回 null 由调用方回退。 */
function placeGeographically(cols: number, rows: number): Placement[] | null {
  const used = new Set<string>()
  const placed: Placement[] = []
  for (const city of CHINA_CITIES) {
    let col = clamp(Math.floor(((city.lon - GEO.west) / (GEO.east - GEO.west)) * cols), 0, cols - 1)
    let row = clamp(Math.floor(((GEO.north - city.lat) / (GEO.north - GEO.south)) * rows), 0, rows - 1)
    let guard = 0
    while (used.has(`${col},${row}`) && guard < cols * rows) {
      col = (col + 1) % cols
      if (col === 0) row = (row + 1) % rows
      guard += 1
    }
    if (used.has(`${col},${row}`)) return null
    used.add(`${col},${row}`)
    placed.push({ city, col, row })
  }
  return placed
}

function placeSequentially(cols: number, rows: number): Placement[] {
  return CHINA_CITIES.map((city, index) => ({
    city,
    col: index % cols,
    row: Math.floor(index / cols) % rows
  }))
}

const spec: D3CaseSpec = {
  id: 'd3-tile-grid-map',
  meta: {
    title: '瓦片格网地图',
    subtitle: '区域规整排布 → 拉伸色块 · 相对地理位置保留',
    description: '把区域单元排成规则瓦片网格并拉伸为 3D 色块，按数值着色、保留相对地理位置。',
    tag: 'D3 网格地图 · tile grid',
    accent: '#60a5fa',
    tips: [
      '按经纬度量化把区域映射到规则网格，尽量保留相对地理位置',
      '当排布冲突或数据不足时自动回退到 7×8 顺序网格',
      '每个格子用拉伸立方体表达数值，颜色与高度由 d3 比例尺驱动'
    ]
  },
  defaults: {
    heightScale: 320000,
    ramp: 'coolwarm',
    gap: 0.2,
    showLabels: true,
    layout: 'geo'
  },
  camera: { lon: 107, lat: 34, height: 5600000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'heightScale', label: '高度倍率', min: 50000, max: 800000, step: 25000 },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'coolwarm', label: 'coolwarm' },
        { value: 'turbo', label: 'turbo' },
        { value: 'spectral', label: 'spectral' },
        { value: 'sunset', label: 'sunset' }
      ]
    },
    { kind: 'range', key: 'gap', label: '格间距', min: 0, max: 0.6, step: 0.05 },
    { kind: 'checkbox', key: 'showLabels', label: '显示区域标签' },
    {
      kind: 'select',
      key: 'layout',
      label: '排布方式',
      options: [
        { value: 'geo', label: '相对地理' },
        { value: 'grid', label: '顺序网格' }
      ]
    }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const heightScale = Number(settings.heightScale)
    const palette = String(settings.ramp)
    const gap = Number(settings.gap)
    const showLabels = Boolean(settings.showLabels)
    const layout = String(settings.layout)

    const cols = 7
    const geoRows = 6
    let rows = geoRows
    let placed: Placement[] | null = layout === 'geo' ? placeGeographically(cols, geoRows) : null
    let fallback = false
    if (!placed) {
      rows = 8
      placed = placeSequentially(cols, rows)
      fallback = true
    }

    const cellW = (GEO.east - GEO.west) / cols
    const cellH = (GEO.north - GEO.south) / rows
    const maxValue = max(CHINA_CITIES, (city: CityDatum) => city.value) ?? 1
    const sizeMeters = cellW * 111320 * (1 - gap)

    placed.forEach((placement) => {
      const centerLon = GEO.west + (placement.col + 0.5) * cellW
      const centerLat = GEO.north - (placement.row + 0.5) * cellH
      const ratio = placement.city.value / maxValue
      addBox(ctx.dataSource, centerLon, centerLat, {
        size: sizeMeters,
        height: Math.max(2000, ratio * heightScale),
        base: 0,
        color: ramp(palette, ratio),
        alpha: 0.9,
        outline: true,
        outlineColor: '#0f172a'
      })
      if (showLabels) {
        addLabel(ctx.dataSource, centerLon, centerLat, `${placement.city.name} ${placement.city.value}`, {
          font: '11px sans-serif',
          color: '#e2e8f0',
          scaleByDistance: [1500000, 0.35, 12000000, 1.3],
          disableDepthTest: true
        })
      }
    })

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `数值 ${maxValue} → 高度 ${heightScale.toLocaleString()}`, color: '#60a5fa' }
    ])
    ctx.status(
      `网格布局 ${cols}×${rows} · 区域 ${placed.length} 个${fallback ? '（已回退顺序网格）' : '（相对地理排布）'} · 峰值 ${maxValue}`
    )
  }
}

export default spec
