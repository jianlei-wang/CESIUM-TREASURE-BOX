import { stack } from 'd3'
import type { D3CaseSpec } from '../types'
import { CHINA_CITIES, mulberry32 } from '../data'
import { ramp } from '../palettes'
import { addBox, addLabel } from '../render'

const KEYS = ['a', 'b', 'c']
const BAR_CITIES = CHINA_CITIES.slice(0, 10)

type MetricRow = { city: (typeof CHINA_CITIES)[number]; a: number; b: number; c: number }

const spec: D3CaseSpec = {
  id: 'd3-stacked-bar',
  meta: {
    title: '三维堆叠与分组柱状图',
    subtitle: 'd3.stack 分层累计 → Cesium Box 逐层堆叠',
    description: '把城市多指标经 d3.stack 分层累计，逐层生成方块底座与高度，切换堆叠/分组两种布局。',
    tag: 'D3 统计图形 · 堆叠柱',
    accent: '#22d3ee',
    tips: [
      'd3.stack 输出每层 [y0, y1] 累计区间，高度取差值、底座取 y0，逐层向上码放',
      '分组模式取消累计，把同城多指标按经度方向平移并排展示',
      '色带按层序索引取色，堆叠与分组共用同一套配色，便于对照'
    ]
  },
  defaults: {
    mode: 'stacked',
    heightScale: 180000,
    ramp: 'turbo',
    showLabels: true,
    gap: 0.4,
    seed: 20261006
  },
  camera: { lon: 110, lat: 32, height: 6000000, pitch: -90 },
  controls: [
    {
      kind: 'select',
      key: 'mode',
      label: '布局模式',
      options: [
        { value: 'stacked', label: '堆叠 stacked' },
        { value: 'grouped', label: '分组 grouped' }
      ]
    },
    { kind: 'range', key: 'heightScale', label: '高度倍率', min: 20000, max: 320000, step: 20000 },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'turbo', label: 'turbo' },
        { value: 'viridis', label: 'viridis' },
        { value: 'spectral', label: 'spectral' }
      ]
    },
    { kind: 'checkbox', key: 'showLabels', label: '显示城市总量' },
    { kind: 'range', key: 'gap', label: '分组间距', min: 0, max: 1, step: 0.1 },
    { kind: 'range', key: 'seed', label: '数据种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const mode = String(settings.mode)
    const heightScale = Number(settings.heightScale)
    const palette = String(settings.ramp)
    const showLabels = Boolean(settings.showLabels)
    const gap = Number(settings.gap)
    const seed = Number(settings.seed)

    const rng = mulberry32(seed)
    const rows: MetricRow[] = BAR_CITIES.map((city) => ({
      city,
      a: 20 + rng() * 80,
      b: 20 + rng() * 80,
      c: 20 + rng() * 80
    }))

    const maxTotal = Math.max(...rows.map((row) => row.a + row.b + row.c))

    const series = stack().keys(KEYS)(rows) as Array<Array<[number, number]>>

    series.forEach((layer, layerIndex) => {
      const color = ramp(palette, KEYS.length > 1 ? layerIndex / (KEYS.length - 1) : 0)
      layer.forEach((pair, cityIndex) => {
        const row = rows[cityIndex]
        const value = pair[1] - pair[0]
        if (value <= 0) return

        if (mode === 'grouped') {
          const offset = (layerIndex - (KEYS.length - 1) / 2) * (1.6 + gap)
          addBox(ctx.dataSource, row.city.lon + offset, row.city.lat, {
            size: 46000,
            height: Math.max(3000, value * heightScale),
            base: 0,
            color,
            alpha: 0.92,
            outline: true,
            outlineColor: '#0f172a'
          })
        } else {
          addBox(ctx.dataSource, row.city.lon, row.city.lat, {
            size: 56000,
            height: Math.max(3000, value * heightScale),
            base: pair[0] * heightScale,
            color,
            alpha: 0.94,
            outline: true,
            outlineColor: '#0f172a'
          })
        }
      })
    })

    if (showLabels) {
      rows.forEach((row) => {
        addLabel(ctx.dataSource, row.city.lon, row.city.lat, `${row.city.name} ${Math.round(row.a + row.b + row.c)}`, {
          font: '11px sans-serif',
          disableDepthTest: true,
          scaleByDistance: [1000000, 0.4, 9000000, 1.3]
        })
      })
    }

    ctx.legend(
      KEYS.map((key, index) => ({
        label: `指标 ${key.toUpperCase()}`,
        color: ramp(palette, KEYS.length > 1 ? index / (KEYS.length - 1) : 0)
      }))
    )
    ctx.status(
      `${mode === 'grouped' ? '分组' : '堆叠'}模式：${rows.length} 座城市 × ${KEYS.length} 指标，峰值合计 ${Math.round(maxTotal)}`
    )
  }
}

export default spec
