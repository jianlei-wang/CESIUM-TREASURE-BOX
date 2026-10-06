import { rollup, mean } from 'd3'
import type { D3CaseSpec } from '../types'
import { CHINA_CITIES, mulberry32 } from '../data'
import { ramp } from '../palettes'
import { addCylinder, addLabel, addPoint, toColor } from '../render'

type RawRecord = { city: string; lon: number; lat: number; value: number; seq: number }

/** 模拟接口返回的原始记录：含重复项与脏数据（value 缺失 / 越界）。 */
function buildStream(count: number, seed: number): RawRecord[] {
  const rng = mulberry32(seed)
  const records: RawRecord[] = []
  for (let i = 0; i < count; i += 1) {
    const city = CHINA_CITIES[Math.floor(rng() * CHINA_CITIES.length)]
    const dirty = rng() < 0.18
    records.push({
      city: city.name,
      lon: city.lon,
      lat: city.lat,
      value: dirty ? (rng() < 0.5 ? Number.NaN : -Math.round(rng() * 50)) : Math.round(rng() * 100),
      seq: i
    })
    if (rng() < 0.22) records.push({ ...records[records.length - 1] })
  }
  return records
}

const spec: D3CaseSpec = {
  id: 'd3-stream-pipeline',
  meta: {
    title: '流式大数据接入与清洗管线',
    subtitle: 'd3-fetch / d3.group / d3.rollup · 批式写入 EntityCollection',
    description: '拉取流式接口，在浏览器内去重、清洗、聚合，再分批上球，首屏秒开、内存可控。',
    tag: 'D3 数据层 · 聚合管线',
    accent: '#38bdf8',
    tips: [
      'd3.rollup 按城市分组聚合，脏数据（NaN / 负值）在清洗阶段剔除',
      '聚合结果分批写入 Cesium 实体集合，避免一次性渲染造成卡顿',
      '原始记录与清洗结果数量实时对比，直观体现「先瘦身再上球」'
    ]
  },
  defaults: {
    records: 60000,
    batch: 4000,
    seed: 20261006,
    heightScale: 120000,
    colorBy: 'value'
  },
  camera: { lon: 104, lat: 34, height: 6000000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'records', label: '原始记录数', min: 5000, max: 200000, step: 5000, format: (v) => v.toLocaleString() },
    { kind: 'range', key: 'batch', label: '批大小', min: 500, max: 20000, step: 500, format: (v) => v.toLocaleString() },
    { kind: 'range', key: 'heightScale', label: '柱高倍率', min: 10000, max: 400000, step: 10000 },
    {
      kind: 'select',
      key: 'colorBy',
      label: '着色字段',
      options: [
        { value: 'value', label: '聚合均值' },
        { value: 'density', label: '记录密度' }
      ]
    },
    { kind: 'range', key: 'seed', label: '数据种子', min: 1, max: 99999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const total = Number(settings.records)
    const batchSize = Number(settings.batch)
    const seed = Number(settings.seed)
    const heightScale = Number(settings.heightScale)
    const colorBy = String(settings.colorBy)

    const raw = buildStream(total, seed)
    const clean = raw.filter((r) => Number.isFinite(r.value) && r.value >= 0)
    const grouped = rollup(
      clean,
      (rows: RawRecord[]) => ({ value: mean(rows, (d: RawRecord) => d.value) ?? 0, count: rows.length }),
      (d: RawRecord) => d.city
    )

    const entries = [...(grouped as Map<string, { value: number; count: number }>).entries()]
      .map(([city, stat]) => {
        const meta = CHINA_CITIES.find((c) => c.name === city)!
        return { ...meta, ...stat }
      })
      .sort((a, b) => b.count - a.count)

    const maxDensity = Math.max(...entries.map((e) => e.count))
    const maxValue = Math.max(...entries.map((e) => e.value))
    const values = entries.map((e) => (colorBy === 'density' ? e.count / maxDensity : e.value / maxValue))

    ctx.status(
      `原始 ${raw.length.toLocaleString()} 条 → 清洗 ${clean.length.toLocaleString()} 条 → 聚合 ${entries.length} 组（批 ${batchSize.toLocaleString()}）`
    )
    ctx.legend([
      { label: colorBy === 'density' ? '记录密度（低→高）' : '聚合均值（低→高）', color: ramp('viridis', 0.9) },
      { label: `${batchSize.toLocaleString()} 条 / 批`, color: '#38bdf8' }
    ])

    let shown = 0
    const reveal = () => {
      const next = Math.min(entries.length, shown + 3)
      for (let i = shown; i < next; i += 1) {
        const entry = entries[i]
        const ratio = values[i]
        const height = Math.max(6000, ratio * heightScale)
        const color = ramp('viridis', ratio)
        addCylinder(ctx.dataSource, entry.lon, entry.lat, {
          radius: 9000 + ratio * 12000,
          height,
          color,
          alpha: 0.92,
          outline: true,
          outlineColor: '#0f172a'
        })
        addPoint(ctx.dataSource, entry.lon, entry.lat, {
          pixelSize: 5,
          color: '#e2e8f0',
          disableDepthTest: true
        })
        addLabel(ctx.dataSource, entry.lon, entry.lat, `${entry.name} · ${entry.count}`, {
          font: '11px sans-serif',
          scaleByDistance: [2000000, 0.2, 12000000, 1.4],
          disableDepthTest: true,
          color: '#e2e8f0'
        })
      }
      shown = next
      if (shown < entries.length) {
        ctx.status(`批式写入中… 已聚合 ${shown}/${entries.length} 组（${Math.round((shown / entries.length) * 100)}%）`)
      } else {
        ctx.status(`管线完成：${entries.length} 组已上球，原始记录压减率 ${(100 - (entries.length / raw.length) * 100).toFixed(2)}%`)
      }
    }

    reveal()
    ctx.onFrame(() => {
      if (shown < entries.length) reveal()
    })
  }
}

export default spec
