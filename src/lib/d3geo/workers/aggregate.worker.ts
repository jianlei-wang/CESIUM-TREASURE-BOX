/// <reference lib="webworker" />
import type { AggregateRequest, AggregateResponse } from './protocol'

type Acc = { cx: number; cy: number; count: number; sum: number; min: number; max: number }

function hexbin(request: AggregateRequest): AggregateResponse {
  const start = performance.now()
  const r = Math.max(0.0001, request.param)
  const lat0 = request.lat0 ?? 34
  const cos = Math.cos((lat0 * Math.PI) / 180) || 0.01
  const w = 2 * r
  const h = Math.sqrt(3) * r
  const buckets = new Map<string, Acc>()
  const { positions, values } = request
  const length = values.length

  for (let i = 0; i < length; i += 1) {
    const x = positions[i * 2] * cos
    const y = positions[i * 2 + 1]
    const j0 = Math.round(y / h)
    let bestI = 0
    let bestJ = 0
    let bestCx = 0
    let bestCy = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let j = j0 - 1; j <= j0 + 1; j += 1) {
      const offset = (((j % 2) + 2) % 2) === 0 ? 0 : r
      const i0 = Math.round((x - offset) / w)
      for (let ii = i0 - 1; ii <= i0 + 1; ii += 1) {
        const cx = ii * w + offset
        const cy = j * h
        const dist = (cx - x) ** 2 + (cy - y) ** 2
        if (dist < bestDist) {
          bestDist = dist
          bestI = ii
          bestJ = j
          bestCx = cx
          bestCy = cy
        }
      }
    }
    const key = `${bestI},${bestJ}`
    let acc = buckets.get(key)
    if (!acc) {
      acc = { cx: bestCx, cy: bestCy, count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
      buckets.set(key, acc)
    }
    const value = values[i]
    acc.count += 1
    acc.sum += value
    if (value < acc.min) acc.min = value
    if (value > acc.max) acc.max = value
  }
  return pack(buckets, (acc) => acc.cx / cos, (acc) => acc.cy, length, start)
}

function grid(request: AggregateRequest): AggregateResponse {
  const start = performance.now()
  const size = Math.max(0.0001, request.param)
  const buckets = new Map<string, Acc>()
  const { positions, values } = request
  const length = values.length
  for (let i = 0; i < length; i += 1) {
    const lon = positions[i * 2]
    const lat = positions[i * 2 + 1]
    const gi = Math.floor(lon / size)
    const gj = Math.floor(lat / size)
    const key = `${gi},${gj}`
    let acc = buckets.get(key)
    if (!acc) {
      acc = { cx: (gi + 0.5) * size, cy: (gj + 0.5) * size, count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
      buckets.set(key, acc)
    }
    const value = values[i]
    acc.count += 1
    acc.sum += value
    if (value < acc.min) acc.min = value
    if (value > acc.max) acc.max = value
  }
  return pack(buckets, (acc) => acc.cx, (acc) => acc.cy, length, start)
}

function pack(
  buckets: Map<string, Acc>,
  lonOf: (acc: Acc) => number,
  latOf: (acc: Acc) => number,
  inputLength: number,
  start: number
): AggregateResponse {
  const count = buckets.size
  const lon = new Float32Array(count)
  const lat = new Float32Array(count)
  const sum = new Float32Array(count)
  const min = new Float32Array(count)
  const max = new Float32Array(count)
  const cellCounts = new Uint32Array(count)
  let index = 0
  for (const acc of buckets.values()) {
    lon[index] = lonOf(acc)
    lat[index] = latOf(acc)
    sum[index] = acc.sum
    min[index] = acc.min
    max[index] = acc.max
    cellCounts[index] = acc.count
    index += 1
  }
  return {
    id: 0,
    count,
    lon,
    lat,
    sum,
    min,
    max,
    cellCounts,
    compression: inputLength > 0 ? 1 - count / inputLength : 0,
    elapsed: performance.now() - start
  }
}

self.onmessage = (event: MessageEvent<AggregateRequest>) => {
  const request = event.data
  const response = request.mode === 'grid' ? grid(request) : hexbin(request)
  response.id = request.id
  ;(self as unknown as Worker).postMessage(response, [
    response.lon.buffer,
    response.lat.buffer,
    response.sum.buffer,
    response.min.buffer,
    response.max.buffer,
    response.cellCounts.buffer
  ])
}
