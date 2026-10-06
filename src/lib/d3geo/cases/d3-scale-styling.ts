import { extent, scaleLinear, scaleLog, scaleQuantize } from 'd3'
import type { D3CaseSpec } from '../types'
import { valueNoise2D } from '../data'
import { ramp } from '../palettes'
import { addBox } from '../render'

const COLS = 16
const ROWS = 12
const WEST = 95
const EAST = 125
const SOUTH = 20
const NORTH = 45

const spec: D3CaseSpec = {
  id: 'd3-scale-styling',
  meta: {
    title: '尺度驱动样式映射',
    subtitle: 'd3.scaleLinear / scaleLog / scaleQuantize · 数据即样式',
    description: '把规则格网数值分别映射到色带与柱高，切换尺度类型即可直观看到分布被重新裁剪。',
    tag: 'D3 比例尺 · 视觉编码',
    accent: '#4ade80',
    tips: [
      '同一组数值分别经过线性、对数、量化尺度，颜色与高度呈现不同分布形态',
      'scaleQuantize 把连续值切分为离散色阶，适合分级统计图',
      '色带与柱高共用归一化结果，保证「数值越大单位越亮越高」的一致编码'
    ]
  },
  defaults: {
    scaleType: 'linear',
    ramp: 'viridis',
    heightScale: 260000,
    opacity: 0.9,
    seed: 20261006
  },
  camera: { lon: 105, lat: 33, height: 5500000, pitch: -90 },
  controls: [
    {
      kind: 'select',
      key: 'scaleType',
      label: '尺度类型',
      options: [
        { value: 'linear', label: 'scaleLinear 线性' },
        { value: 'log', label: 'scaleLog 对数' },
        { value: 'quantize', label: 'scaleQuantize 量化' }
      ]
    },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'viridis', label: 'viridis' },
        { value: 'turbo', label: 'turbo' },
        { value: 'inferno', label: 'inferno' },
        { value: 'spectral', label: 'spectral' }
      ]
    },
    { kind: 'range', key: 'heightScale', label: '柱高倍率', min: 40000, max: 600000, step: 20000 },
    { kind: 'range', key: 'opacity', label: '透明度', min: 0.3, max: 1, step: 0.05 },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const kind = String(settings.scaleType)
    const palette = String(settings.ramp)
    const heightScale = Number(settings.heightScale)
    const alpha = Number(settings.opacity)
    const seed = Number(settings.seed)

    const field = valueNoise2D(COLS, ROWS, seed, 4)
    const values: number[] = []
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) values.push(field[y][x] * 100)
    }
    const [min, max] = extent(values) as [number, number]

    const heightNorm = scaleLinear().domain([min, max]).range([0, 1])
    const stops = Array.from({ length: 7 }, (_: unknown, i: number) => ramp(palette, i / 6))

    let colorOf: (value: number) => string
    if (kind === 'log') {
      const logScale = scaleLog()
        .domain([Math.max(1, min), Math.max(2, max)])
        .range([0, 1])
      colorOf = (value: number) => ramp(palette, logScale(Math.max(1, value)))
    } else if (kind === 'quantize') {
      const quantScale = scaleQuantize().domain([min, max]).range(stops)
      colorOf = (value: number) => String(quantScale(value))
    } else {
      const linearScale = scaleLinear().domain([min, max]).range([0, 1])
      colorOf = (value: number) => ramp(palette, linearScale(value))
    }

    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const value = values[y * COLS + x]
        const t = Math.min(1, Math.max(0, heightNorm(value)))
        const lon = WEST + ((x + 0.5) / COLS) * (EAST - WEST)
        const lat = NORTH - ((y + 0.5) / ROWS) * (NORTH - SOUTH)
        const cosLat = Math.cos((lat * Math.PI) / 180) || 0.3
        const size = ((EAST - WEST) / COLS) * 111320 * cosLat * 0.8

        addBox(ctx.dataSource, lon, lat, {
          size,
          height: Math.max(2000, t * heightScale),
          color: colorOf(value),
          alpha,
          outline: true,
          outlineColor: '#0f172a'
        })
      }
    }

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `${COLS}×${ROWS} 网格 · ${kind}`, color: colorOf(max) },
      { label: `值域 ${min.toFixed(1)} ~ ${max.toFixed(1)}`, color: colorOf(min) }
    ])
    ctx.status(`${kind} 尺度映射 ${values.length} 个格网单元，值域 ${min.toFixed(1)} ~ ${max.toFixed(1)}`)
  }
}

export default spec
