/**
 * 等值线矢量化：对连续栅格按阈值提取等值线（Marching Squares），
 * 折线经 RDP 简化后输出经纬度坐标，用于矢量结果展示与导出。
 */
import { simplifyLine, linePixelLength } from '../ridge-valley-lib/vectorize'
import type { LonLat } from './types'

type PixelPoint = [number, number]

type Segment = [number, number]

function edgePoint(a: number, b: number, threshold: number): number {
  const denom = b - a
  if (Math.abs(denom) < 1e-12) return 0.5
  const t = (threshold - a) / denom
  return t < 0 ? 0 : t > 1 ? 1 : t
}

export type ContourOptions = {
  minLengthPx?: number
  simplifyTolerance?: number
  transform: (col: number, row: number) => LonLat
}

export function marchingSquaresContours(
  values: Float32Array,
  width: number,
  height: number,
  threshold: number,
  options: ContourOptions
): LonLat[][] {
  const minLengthPx = options.minLengthPx ?? 3
  const tolerance = options.simplifyTolerance ?? 0.6
  const coords: PixelPoint[] = []
  const idByKey = new Map<string, number>()
  const segments: Segment[] = []

  const pointId = (x: number, y: number): number => {
    const key = `${x.toFixed(4)},${y.toFixed(4)}`
    let id = idByKey.get(key)
    if (id === undefined) {
      id = coords.length
      coords.push([x, y])
      idByKey.set(key, id)
    }
    return id
  }

  for (let r = 0; r < height - 1; r += 1) {
    for (let c = 0; c < width - 1; c += 1) {
      const tl = values[r * width + c]
      const tr = values[r * width + c + 1]
      const br = values[(r + 1) * width + c + 1]
      const bl = values[(r + 1) * width + c]
      if (!Number.isFinite(tl) || !Number.isFinite(tr) || !Number.isFinite(br) || !Number.isFinite(bl)) continue
      let index = 0
      if (tl > threshold) index |= 1
      if (tr > threshold) index |= 2
      if (br > threshold) index |= 4
      if (bl > threshold) index |= 8
      if (index === 0 || index === 15) continue

      const T: PixelPoint = [c + edgePoint(tl, tr, threshold), r]
      const R: PixelPoint = [c + 1, r + edgePoint(tr, br, threshold)]
      const B: PixelPoint = [c + edgePoint(bl, br, threshold), r + 1]
      const L: PixelPoint = [c, r + edgePoint(tl, bl, threshold)]

      const add = (p1: PixelPoint, p2: PixelPoint): void => {
        segments.push([pointId(p1[0], p1[1]), pointId(p2[0], p2[1])])
      }

      switch (index) {
        case 1:
        case 14:
          add(L, T)
          break
        case 2:
        case 13:
          add(T, R)
          break
        case 3:
        case 12:
          add(L, R)
          break
        case 4:
        case 11:
          add(R, B)
          break
        case 6:
        case 9:
          add(T, B)
          break
        case 7:
        case 8:
          add(L, B)
          break
        case 5:
          add(L, T)
          add(R, B)
          break
        default: // 10
          add(T, R)
          add(B, L)
          break
      }
    }
  }

  const adjacency = new Map<number, number[]>()
  const attach = (point: number, seg: number): void => {
    const list = adjacency.get(point)
    if (list) list.push(seg)
    else adjacency.set(point, [seg])
  }
  segments.forEach((seg, index) => {
    attach(seg[0], index)
    attach(seg[1], index)
  })

  const used = new Uint8Array(segments.length)
  const chains: number[][] = []
  for (let i = 0; i < segments.length; i += 1) {
    if (used[i]) continue
    used[i] = 1
    const chain = [segments[i][0], segments[i][1]]
    let grow = true
    while (grow) {
      grow = false
      const end = chain[chain.length - 1]
      for (const si of adjacency.get(end) ?? []) {
        if (used[si]) continue
        used[si] = 1
        const seg = segments[si]
        chain.push(seg[0] === end ? seg[1] : seg[0])
        grow = true
        break
      }
    }
    grow = true
    while (grow) {
      grow = false
      const start = chain[0]
      for (const si of adjacency.get(start) ?? []) {
        if (used[si]) continue
        used[si] = 1
        const seg = segments[si]
        chain.unshift(seg[0] === start ? seg[1] : seg[0])
        grow = true
        break
      }
    }
    chains.push(chain)
  }

  const out: LonLat[][] = []
  for (const chain of chains) {
    const pixel: PixelPoint[] = chain.map((id) => coords[id])
    if (pixel.length < 2) continue
    const simplified = simplifyLine(pixel, tolerance)
    if (linePixelLength(simplified) < minLengthPx) continue
    out.push(simplified.map(([c, r]) => options.transform(c, r)))
  }
  return out
}

export function demTransform(dem: { west: number; east: number; south: number; north: number; width: number; height: number }) {
  return (col: number, row: number): LonLat => ({
    lon: dem.west + (col / Math.max(1, dem.width - 1)) * (dem.east - dem.west),
    lat: dem.north - (row / Math.max(1, dem.height - 1)) * (dem.north - dem.south)
  })
}
