import type { Bbox, ColorStop, InterpGrid } from './idw'

export type HazardLayerId = 'flood' | 'wind' | 'quake' | 'heat'

export type HazardLayer = {
  id: HazardLayerId
  label: string
  weight: number
  enabled: boolean
  stops: ColorStop[]
}

export const HAZARD_LAYERS: HazardLayer[] = [
  {
    id: 'flood',
    label: '内涝',
    weight: 0.35,
    enabled: true,
    stops: [
      { stop: 0, r: 40, g: 110, b: 210 },
      { stop: 1, r: 120, g: 220, b: 255 }
    ]
  },
  {
    id: 'wind',
    label: '大风',
    weight: 0.25,
    enabled: true,
    stops: [
      { stop: 0, r: 60, g: 190, b: 160 },
      { stop: 1, r: 200, g: 255, b: 210 }
    ]
  },
  {
    id: 'quake',
    label: '地震',
    weight: 0.25,
    enabled: true,
    stops: [
      { stop: 0, r: 220, g: 170, b: 60 },
      { stop: 1, r: 255, g: 230, b: 150 }
    ]
  },
  {
    id: 'heat',
    label: '高温',
    weight: 0.15,
    enabled: true,
    stops: [
      { stop: 0, r: 210, g: 70, b: 90 },
      { stop: 1, r: 255, g: 170, b: 170 }
    ]
  }
]

function hashNoise(x: number, y: number, seed: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
  return v - Math.floor(v)
}

function smoothField(lon: number, lat: number, bbox: Bbox, seed: number, scale: number): number {
  const u = ((lon - bbox.lonMin) / (bbox.lonMax - bbox.lonMin || 1)) * scale
  const v = ((lat - bbox.latMin) / (bbox.latMax - bbox.latMin || 1)) * scale
  const iu = Math.floor(u)
  const iv = Math.floor(v)
  const fu = u - iu
  const fv = v - iv
  const su = fu * fu * (3 - 2 * fu)
  const sv = fv * fv * (3 - 2 * fv)
  const a = hashNoise(iu, iv, seed)
  const b = hashNoise(iu + 1, iv, seed)
  const c = hashNoise(iu, iv + 1, seed)
  const d = hashNoise(iu + 1, iv + 1, seed)
  const top = a + (b - a) * su
  const bottom = c + (d - c) * su
  return top + (bottom - top) * sv
}

export function hazardValue(id: HazardLayerId, lon: number, lat: number, bbox: Bbox, phase: number): number {
  const u = (lon - bbox.lonMin) / (bbox.lonMax - bbox.lonMin || 1)
  const v = (lat - bbox.latMin) / (bbox.latMax - bbox.latMin || 1)
  const base = smoothField(lon, lat, bbox, 11, 5) * 0.65 + smoothField(lon, lat, bbox, 29, 12) * 0.35
  switch (id) {
    case 'flood': {
      const river = Math.exp(-Math.pow((u - (0.42 + 0.1 * Math.sin(v * 6 + phase))) * 5.5, 2))
      const depression = Math.exp(-Math.pow((v - 0.35) * 4.2, 2)) * 0.35
      return Math.min(1, river * 0.8 + depression + base * 0.25)
    }
    case 'wind': {
      const corridor = 0.5 + 0.5 * Math.sin((u * 5 + v * 2.4 + phase) * Math.PI)
      return Math.min(1, corridor * 0.55 + base * 0.55)
    }
    case 'quake': {
      const fault = Math.exp(-Math.pow((v - 0.62 + 0.06 * Math.sin(u * 8)) * 9, 2))
      return Math.min(1, fault * 0.85 + base * 0.3)
    }
    case 'heat':
    default: {
      const center = Math.exp(-(((u - 0.62) ** 2 + (v - 0.55) ** 2) * 9))
      return Math.min(1, center * 0.75 + base * 0.45)
    }
  }
}

export function fuseHazards(
  bbox: Bbox,
  width: number,
  height: number,
  layers: HazardLayer[],
  phase: number
): InterpGrid {
  const data = new Float32Array(width * height)
  const variance = new Float32Array(width * height)
  const active = layers.filter((l) => l.enabled)
  const weightSum = active.reduce((s, l) => s + l.weight, 0) || 1
  let valueMin = Infinity
  let valueMax = -Infinity
  for (let row = 0; row < height; row += 1) {
    const lat = bbox.latMin + ((row + 0.5) / height) * (bbox.latMax - bbox.latMin)
    for (let col = 0; col < width; col += 1) {
      const lon = bbox.lonMin + ((col + 0.5) / width) * (bbox.lonMax - bbox.lonMin)
      let sum = 0
      let sqSum = 0
      for (const layer of active) {
        const v = hazardValue(layer.id, lon, lat, bbox, phase)
        sum += v * layer.weight
        sqSum += v * v * layer.weight
      }
      const fused = sum / weightSum
      const idx = row * width + col
      data[idx] = fused
      variance[idx] = Math.sqrt(Math.max(0, sqSum / weightSum - fused * fused))
      if (fused < valueMin) valueMin = fused
      if (fused > valueMax) valueMax = fused
    }
  }
  return {
    data,
    variance,
    width,
    height,
    latMin: bbox.latMin,
    latMax: bbox.latMax,
    lonMin: bbox.lonMin,
    lonMax: bbox.lonMax,
    valueMin: Number.isFinite(valueMin) ? valueMin : 0,
    valueMax: Number.isFinite(valueMax) ? valueMax : 1
  }
}

export function classifyRisk(value: number): { level: string; color: string } {
  if (value >= 0.72) return { level: '极高', color: '#d63b55' }
  if (value >= 0.55) return { level: '高', color: '#e88b3a' }
  if (value >= 0.38) return { level: '中', color: '#d9c145' }
  if (value >= 0.22) return { level: '低', color: '#57b98a' }
  return { level: '极低', color: '#3f8fd1' }
}
