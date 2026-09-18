/**
 * 生成一段内置的本地 3D Tiles 点云示例数据（.pnts），
 * 用于在没有现成倾斜摄影数据时验证「本地 3DTiles 加载」整条管线。
 * 数据为 WGS84 ECEF 绝对坐标，无需 georeference transform。
 */

export type SampleFile = { path: string; file: File }

const EARTH_A = 6378137
const EARTH_F = 1 / 298.257223563
const EARTH_E2 = EARTH_F * (2 - EARTH_F)

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

export function lonLatHToEcef(lonDeg: number, latDeg: number, height: number): [number, number, number] {
  const lon = toRadians(lonDeg)
  const lat = toRadians(latDeg)
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const n = EARTH_A / Math.sqrt(1 - EARTH_E2 * sinLat * sinLat)
  const x = (n + height) * cosLat * Math.cos(lon)
  const y = (n + height) * cosLat * Math.sin(lon)
  const z = (n * (1 - EARTH_E2) + height) * sinLat
  return [x, y, z]
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = mulberry32(20260909)

function colorGradient(frac: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [46, 196, 219]],
    [0.5, [120, 178, 232]],
    [1, [240, 148, 92]]
  ]
  let low = stops[0]
  let high = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (frac >= stops[i][0] && frac <= stops[i + 1][0]) {
      low = stops[i]
      high = stops[i + 1]
      break
    }
  }
  const span = Math.max(high[0] - low[0], 1e-6)
  const t = Math.min(Math.max((frac - low[0]) / span, 0), 1)
  const from = low[1]
  const to = high[1]
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t)
  ]
}

type PointData = { positions: Float32Array; colors: Uint8Array; ecefMin: [number, number, number]; ecefMax: [number, number, number] }

function buildTowerCloud(fine: boolean): PointData {
  const baseLon = 116.3912
  const baseLat = 39.906
  const baseHeight = 40
  const topHeight = 220
  const levelCount = fine ? 26 : 9
  const points: number[] = []
  const colors: number[] = []
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  const push = (lon: number, lat: number, height: number, color: [number, number, number]): void => {
    const [x, y, z] = lonLatHToEcef(lon, lat, height)
    points.push(x, y, z)
    colors.push(color[0], color[1], color[2])
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }

  for (let i = 0; i < levelCount; i += 1) {
    const frac = i / (levelCount - 1)
    const height = baseHeight + (topHeight - baseHeight) * frac
    const radius = 70 * (1 - frac) + 12
    const ringCount = Math.max(fine ? 64 : 24, Math.round(ringCountFor(fine, frac)))
    const color = colorGradient(frac)
    for (let k = 0; k < ringCount; k += 1) {
      const angle = (k / ringCount) * Math.PI * 2 + (fine ? random() * 0.1 : 0)
      const jitter = radius * (fine ? 0.25 : 0.45)
      const r = Math.max(0, radius - random() * jitter)
      const dLat = (r * Math.cos(angle)) / 111000
      const dLon = (r * Math.sin(angle)) / (111000 * Math.cos(toRadians(baseLat)))
      const hJitter = (fine ? 1.2 : 3) * (random() - 0.5)
      push(baseLon + dLon, baseLat + dLat, height + hJitter, color)
    }
    if (!fine && i % 2 === 0) {
      push(baseLon, baseLat, height, [255, 255, 255])
    }
  }

  function ringCountFor(isFine: boolean, frac: number): number {
    return isFine ? Math.round(80 - 45 * frac) : Math.round(20 - 10 * frac)
  }

  return {
    positions: new Float32Array(points),
    colors: new Uint8Array(colors),
    ecefMin: [minX, minY, minZ],
    ecefMax: [maxX, maxY, maxZ]
  }
}

function encodePnts(cloud: PointData): ArrayBuffer {
  const pointCount = cloud.positions.length / 3
  const jsonText = JSON.stringify({
    POINTS_LENGTH: pointCount,
    POSITION: { byteOffset: 0 },
    RGB: { byteOffset: cloud.positions.byteLength }
  })
  const jsonBytes = new TextEncoder().encode(jsonText)
  const paddedJsonLength = Math.ceil(jsonBytes.length / 8) * 8
  const paddedJson = new Uint8Array(paddedJsonLength).fill(0x20)
  paddedJson.set(jsonBytes)
  const featureTableBinaryLength = cloud.positions.byteLength + cloud.colors.byteLength
  const headerLength = 28
  const totalLength = headerLength + paddedJsonLength + featureTableBinaryLength

  const buffer = new ArrayBuffer(totalLength)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  bytes[0] = 0x70
  bytes[1] = 0x6e
  bytes[2] = 0x74
  bytes[3] = 0x73
  view.setUint32(4, 1, true)
  view.setUint32(8, totalLength, true)
  view.setUint32(12, paddedJsonLength, true)
  view.setUint32(16, featureTableBinaryLength, true)
  view.setUint32(20, 0, true)
  view.setUint32(24, 0, true)

  bytes.set(paddedJson, headerLength)
  bytes.set(new Uint8Array(cloud.positions.buffer), headerLength + paddedJsonLength)
  bytes.set(cloud.colors, headerLength + paddedJsonLength + cloud.positions.byteLength)
  return buffer
}

function sphereCovering(cloud: PointData): [number, number, number, number] {
  const center: [number, number, number] = [
    (cloud.ecefMin[0] + cloud.ecefMax[0]) / 2,
    (cloud.ecefMin[1] + cloud.ecefMax[1]) / 2,
    (cloud.ecefMin[2] + cloud.ecefMax[2]) / 2
  ]
  let radius = 0
  for (let i = 0; i < cloud.positions.length; i += 3) {
    const dx = cloud.positions[i] - center[0]
    const dy = cloud.positions[i + 1] - center[1]
    const dz = cloud.positions[i + 2] - center[2]
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist > radius) radius = dist
  }
  return [center[0], center[1], center[2], radius + 5]
}

export async function buildLocalTilesetSample(): Promise<SampleFile[]> {
  const coarse = buildTowerCloud(false)
  const fine = buildTowerCloud(true)
  const fineSphere = sphereCovering(fine)

  const tilesetJson = {
    asset: { version: '1.0' },
    geometricError: 2048,
    root: {
      refine: 'REPLACE',
      geometricError: 500,
      boundingVolume: { sphere: fineSphere },
      content: { uri: 'points/coarse.pnts' },
      children: [
        {
          geometricError: 0,
          boundingVolume: { sphere: fineSphere },
          content: { uri: 'points/fine.pnts' }
        }
      ]
    }
  }

  const tilesetFile = new File([JSON.stringify(tilesetJson)], 'tileset.json', { type: 'application/json' })
  const coarseFile = new File([encodePnts(coarse)], 'coarse.pnts', { type: 'application/octet-stream' })
  const fineFile = new File([encodePnts(fine)], 'fine.pnts', { type: 'application/octet-stream' })

  return [
    { path: 'tileset.json', file: tilesetFile },
    { path: 'points/coarse.pnts', file: coarseFile },
    { path: 'points/fine.pnts', file: fineFile }
  ]
}

export function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const types: Record<string, string> = {
    json: 'application/json',
    b3dm: 'application/octet-stream',
    i3dm: 'application/octet-stream',
    pnts: 'application/octet-stream',
    cmpt: 'application/octet-stream',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    bin: 'application/octet-stream'
  }
  return types[ext] ?? 'application/octet-stream'
}
