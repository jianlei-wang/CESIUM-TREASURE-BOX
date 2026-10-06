import { max, mean, rollup, sum } from 'd3'
import type { D3CaseSpec } from '../types'
import { mulberry32 } from '../data'
import { ramp } from '../palettes'
import { addBox, addLabel, addPoint, addPolygon, addPolyline } from '../render'

type Building = {
  lon: number
  lat: number
  size: number
  height: number
  floors: number
  category: string
  value: number
}

const CENTER = { lon: 116.407, lat: 39.904 }
const CATEGORIES = ['办公', '商业', '住宅', '公共']

/** 程序化生成规则网格上的建筑体块数据。 */
function buildCity(grid: number, heightScale: number, seed: number): Building[] {
  const rng = mulberry32(seed)
  const spacing = 0.0032
  const buildings: Building[] = []
  const offset = (grid - 1) / 2
  for (let row = 0; row < grid; row += 1) {
    for (let col = 0; col < grid; col += 1) {
      if (rng() < 0.12) continue
      const lon = CENTER.lon + (col - offset) * spacing + (rng() - 0.5) * 0.0006
      const lat = CENTER.lat + (row - offset) * spacing + (rng() - 0.5) * 0.0006
      const zoneBoost = 1 - Math.min(1, Math.hypot(col - offset, row - offset) / (offset + 1))
      const height = Math.round((30 + rng() * 120 + zoneBoost * 180) * (heightScale / 220))
      const size = 80 + rng() * 70
      const floors = Math.max(1, Math.round(height / 3.6))
      const category = CATEGORIES[Math.floor(rng() * CATEGORIES.length)]
      buildings.push({ lon, lat, size, height, floors, category, value: Math.round(rng() * 100) })
    }
  }
  return buildings
}

const spec: D3CaseSpec = {
  id: 'd3-cad-model',
  meta: {
    title: 'CAD 模型线面渲染',
    subtitle: '建筑体块面 / 线框 / 顶点 → 分离渲染消除共面闪面',
    description: '程序化生成建筑群，面、线框、顶点三类图元独立显隐，并以 d3 汇总属性表。',
    tag: 'D3 · CAD 线面体',
    accent: '#facc15',
    tips: [
      '半透明面与线框分离成不同实体，避免共面多边形 z-fighting 造成的闪面',
      '线框用顶部轮廓与竖向棱边 polyline 勾勒，顶点用独立点实体标注',
      'd3.rollup / mean / sum 在浏览器内汇总分类数量与体量，输出属性统计表'
    ]
  },
  defaults: {
    showFaces: true,
    showWire: true,
    showVertices: true,
    grid: 6,
    heightScale: 220,
    palette: 'turbo'
  },
  camera: { lon: 116.407, lat: 39.9, height: 4200, heading: 0, pitch: -35 },
  controls: [
    { kind: 'checkbox', key: 'showFaces', label: '显示面' },
    { kind: 'checkbox', key: 'showWire', label: '显示线框' },
    { kind: 'checkbox', key: 'showVertices', label: '显示顶点' },
    { kind: 'range', key: 'grid', label: '网格规模', min: 3, max: 9, step: 1 },
    { kind: 'range', key: 'heightScale', label: '体量倍率', min: 80, max: 420, step: 20 },
    {
      kind: 'select',
      key: 'palette',
      label: '面配色',
      options: [
        { value: 'turbo', label: 'turbo' },
        { value: 'viridis', label: 'viridis' },
        { value: 'plasma', label: 'plasma' },
        { value: 'coolwarm', label: 'coolwarm' }
      ]
    }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const showFaces = Boolean(settings.showFaces)
    const showWire = Boolean(settings.showWire)
    const showVertices = Boolean(settings.showVertices)
    const grid = Number(settings.grid)
    const heightScale = Number(settings.heightScale)
    const palette = String(settings.palette)

    const buildings = buildCity(grid, heightScale, 20261006)
    const maxHeight = max(buildings, (b: Building) => b.height) ?? 1

    const halfLon = (size: number, lat: number) => size / 2 / (111320 * (Math.cos((lat * Math.PI) / 180) || 0.01))
    const halfLat = (size: number) => size / 2 / 110540

    addPolygon(
      ctx.dataSource,
      [
        [CENTER.lon - 0.03, CENTER.lat - 0.03],
        [CENTER.lon + 0.03, CENTER.lat - 0.03],
        [CENTER.lon + 0.03, CENTER.lat + 0.03],
        [CENTER.lon - 0.03, CENTER.lat + 0.03]
      ],
      { height: 2, color: '#0f172a', alpha: 0.35, outline: true, outlineColor: '#334155' }
    )

    buildings.forEach((building) => {
      const ratio = building.height / maxHeight
      const color = ramp(palette, ratio)
      const dLon = halfLon(building.size, building.lat)
      const dLat = halfLat(building.size)
      const corners: Array<[number, number, number]> = [
        [building.lon - dLon, building.lat - dLat, building.height],
        [building.lon + dLon, building.lat - dLat, building.height],
        [building.lon + dLon, building.lat + dLat, building.height],
        [building.lon - dLon, building.lat + dLat, building.height]
      ]

      if (showFaces) {
        addBox(ctx.dataSource, building.lon, building.lat, {
          size: building.size,
          height: building.height,
          color,
          alpha: 0.52
        })
      }

      if (showWire) {
        const loop = [...corners, corners[0]]
        addPolyline(ctx.dataSource, loop, { width: 1.4, color: '#f8fafc', alpha: 0.85 })
        const base = corners.map((c) => [c[0], c[1], 0] as [number, number, number])
        addPolyline(ctx.dataSource, [...base, base[0]], { width: 1, color: '#94a3b8', alpha: 0.6 })
        corners.forEach((corner) => {
          addPolyline(
            ctx.dataSource,
            [
              [corner[0], corner[1], 0],
              [corner[0], corner[1], building.height]
            ],
            { width: 1.2, color: '#facc15', alpha: 0.7 }
          )
        })
      }

      if (showVertices) {
        corners.forEach((corner) => {
          addPoint(ctx.dataSource, corner[0], corner[1], {
            pixelSize: 4,
            color: '#facc15',
            outlineColor: '#0f172a',
            disableDepthTest: true
          })
        })
      }
    })

    if (buildings.length > 0) {
      const tallest = buildings.reduce((a, b) => (a.height >= b.height ? a : b))
      addLabel(ctx.dataSource, tallest.lon, tallest.lat, `最高 ${tallest.height}m`, {
        font: '12px sans-serif',
        color: '#facc15',
        disableDepthTest: true
      })
    }

    const byCategory = rollup(
      buildings,
      (rows: Building[]) => rows.length,
      (b: Building) => b.category
    ) as Map<string, number>
    const avgHeight = mean(buildings, (b: Building) => b.height) ?? 0
    const totalFloors = sum(buildings, (b: Building) => b.floors) ?? 0

    const wrap = document.createElement('div')
    ctx.overlay(wrap)
    const panel = document.createElement('div')
    panel.style.cssText =
      'position:absolute;left:16px;top:16px;width:250px;padding:12px 14px;border-radius:12px;' +
      'background:rgba(15,23,42,0.86);border:1px solid rgba(148,163,184,0.3);color:#cbd5e1;font-size:12px;'
    panel.innerHTML =
      '<div style="color:#facc15;font-size:13px;font-weight:600;margin-bottom:8px;">建筑属性表（d3 汇总）</div>' +
      `<table style="width:100%;border-collapse:collapse;">
        <thead><tr style="color:#7dd3fc;">
          <th style="text-align:left;font-weight:500;padding:2px 0;">类别</th>
          <th style="text-align:right;font-weight:500;">数量</th>
        </tr></thead>
        <tbody>${[...byCategory.entries()]
          .map(
            ([category, count]) =>
              `<tr><td style="padding:2px 0;">${category}</td><td style="text-align:right;">${count}</td></tr>`
          )
          .join('')}</tbody>
      </table>
      <div style="margin-top:8px;border-top:1px solid rgba(148,163,184,0.25);padding-top:6px;">
        总栋数 ${buildings.length}<br/>平均高度 ${avgHeight.toFixed(1)} m<br/>总层数 ${totalFloors}
      </div>`
    wrap.appendChild(panel)

    const modes = [
      showFaces ? '面' : '',
      showWire ? '线框' : '',
      showVertices ? '顶点' : ''
    ].filter(Boolean)

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: '线框', color: '#f8fafc' },
      { label: '顶点', color: '#facc15' }
    ])
    ctx.status(`${buildings.length} 栋建筑，渲染模式 [${modes.join(' + ')}]，均高 ${avgHeight.toFixed(1)}m`)
  }
}

export default spec
