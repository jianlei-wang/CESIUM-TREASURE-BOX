/**
 * 统一的地理大数据内存模型。
 *
 * 所有旗舰案例共享 {@link GeoPointBuffer} / {@link FlowBuffer} /
 * {@link TrajectoryBuffer} 三种 TypedArray 结构，替代 `Array<{lon,lat,...}>`，
 * 保证内存连续、可 Transferable 跨 Worker 传输、可直接喂给 GPU 渲染层。
 */

/** 百万级地理点核心存储：列式 TypedArray，禁止对象数组。 */
export interface GeoPointBuffer {
  /** 点的数量。 */
  length: number
  /** 交错经纬度：[lon0, lat0, lon1, lat1, ...]，长度 = length * 2。 */
  positions: Float32Array
  /** 指标值，长度 = length。 */
  values: Float32Array
  /** 类别编号，长度 = length。 */
  categories: Uint16Array
  /** 时间戳（毫秒），长度 = length。 */
  timestamps: Float64Array
}

export type PointRecord = {
  lon: number
  lat: number
  value?: number
  category?: number
  time?: number
}

export type BufferBounds = { west: number; south: number; east: number; north: number }

/** 预分配容量的点缓冲构建器：append 过程零对象分配。 */
export class GeoPointBufferBuilder {
  private readonly positions: Float32Array
  private readonly values: Float32Array
  private readonly categories: Uint16Array
  private readonly timestamps: Float64Array
  private cursor = 0

  constructor(capacity: number) {
    const size = Math.max(0, Math.floor(capacity))
    this.positions = new Float32Array(size * 2)
    this.values = new Float32Array(size)
    this.categories = new Uint16Array(size)
    this.timestamps = new Float64Array(size)
  }

  get length(): number {
    return this.cursor
  }

  get capacity(): number {
    return this.values.length
  }

  push(lon: number, lat: number, value = 1, category = 0, time = 0): void {
    if (this.cursor >= this.capacity) return
    const offset = this.cursor * 2
    this.positions[offset] = lon
    this.positions[offset + 1] = lat
    this.values[this.cursor] = value
    this.categories[this.cursor] = category
    this.timestamps[this.cursor] = time
    this.cursor += 1
  }

  pushRecord(record: PointRecord): void {
    this.push(record.lon, record.lat, record.value ?? 1, record.category ?? 0, record.time ?? 0)
  }

  /** 输出紧凑切片（长度贴合实际点数，避免 Worker/GPU 读取冗余内存）。 */
  build(): GeoPointBuffer {
    const n = this.cursor
    return {
      length: n,
      positions: n === this.capacity ? this.positions : this.positions.slice(0, n * 2),
      values: n === this.capacity ? this.values : this.values.slice(0, n),
      categories: n === this.capacity ? this.categories : this.categories.slice(0, n),
      timestamps: n === this.capacity ? this.timestamps : this.timestamps.slice(0, n)
    }
  }
}

/** 由对象数组构造 GeoPointBuffer（仅用于小体量真实数据解析的收尾阶段）。 */
export function bufferFromRecords(records: PointRecord[]): GeoPointBuffer {
  const builder = new GeoPointBufferBuilder(records.length)
  for (const record of records) builder.pushRecord(record)
  return builder.build()
}

/** 计算经纬度包围盒，用于相机定位与网格范围。 */
export function bufferBounds(buffer: GeoPointBuffer): BufferBounds {
  let west = Number.POSITIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY
  for (let i = 0; i < buffer.length; i += 1) {
    const lon = buffer.positions[i * 2]
    const lat = buffer.positions[i * 2 + 1]
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  if (!Number.isFinite(west)) return { west: -180, south: -90, east: 180, north: 90 }
  return { west, south, east, north }
}

/** 数值范围 [min, max]。 */
export function bufferValueExtent(buffer: GeoPointBuffer): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < buffer.length; i += 1) {
    const v = buffer.values[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min)) return [0, 1]
  if (min === max) return [min, min + 1]
  return [min, max]
}

/** 时间范围 [min, max]（毫秒）。 */
export function bufferTimeExtent(buffer: GeoPointBuffer): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < buffer.length; i += 1) {
    const t = buffer.timestamps[i]
    if (t < min) min = t
    if (t > max) max = t
  }
  if (!Number.isFinite(min)) return [0, 1]
  if (min === max) return [min, min + 1]
  return [min, max]
}

/** 类别直方图。 */
export function bufferCategoryCounts(buffer: GeoPointBuffer): Uint32Array {
  let maxCategory = 0
  for (let i = 0; i < buffer.length; i += 1) {
    const c = buffer.categories[i]
    if (c > maxCategory) maxCategory = c
  }
  const counts = new Uint32Array(maxCategory + 1)
  for (let i = 0; i < buffer.length; i += 1) counts[buffer.categories[i]] += 1
  return counts
}

/** 抽取子集（按谓词），保持列式结构。 */
export function bufferFilter(buffer: GeoPointBuffer, predicate: (index: number, buffer: GeoPointBuffer) => boolean): GeoPointBuffer {
  let count = 0
  for (let i = 0; i < buffer.length; i += 1) if (predicate(i, buffer)) count += 1
  const builder = new GeoPointBufferBuilder(count)
  for (let i = 0; i < buffer.length; i += 1) {
    if (!predicate(i, buffer)) continue
    builder.push(
      buffer.positions[i * 2],
      buffer.positions[i * 2 + 1],
      buffer.values[i],
      buffer.categories[i],
      buffer.timestamps[i]
    )
  }
  return builder.build()
}

/** 空间分辨率降采样（网格去重），用于极大数据集快速预览。 */
export function bufferDecimate(buffer: GeoPointBuffer, cellSize: number): GeoPointBuffer {
  const seen = new Set<number>()
  const builder = new GeoPointBufferBuilder(buffer.length)
  const scale = 1 / Math.max(1e-6, cellSize)
  for (let i = 0; i < buffer.length; i += 1) {
    const gx = Math.floor(buffer.positions[i * 2] * scale)
    const gy = Math.floor(buffer.positions[i * 2 + 1] * scale)
    const key = ((gx + 100000) * 200003 + (gy + 100000)) | 0
    if (seen.has(key)) continue
    seen.add(key)
    builder.push(
      buffer.positions[i * 2],
      buffer.positions[i * 2 + 1],
      buffer.values[i],
      buffer.categories[i],
      buffer.timestamps[i]
    )
  }
  return builder.build()
}

/** 估算内存占用（字节）。 */
export function bufferByteLength(buffer: GeoPointBuffer): number {
  return (
    buffer.positions.byteLength +
    buffer.values.byteLength +
    buffer.categories.byteLength +
    buffer.timestamps.byteLength
  )
}

/** 所有需要 Transfer 的 ArrayBuffer 列表。 */
export function bufferTransferables(buffer: GeoPointBuffer): ArrayBuffer[] {
  return [
    buffer.positions.buffer as ArrayBuffer,
    buffer.values.buffer as ArrayBuffer,
    buffer.categories.buffer as ArrayBuffer,
    buffer.timestamps.buffer as ArrayBuffer
  ]
}

/** OD 流量缓冲。 */
export interface FlowBuffer {
  length: number
  originLon: Float32Array
  originLat: Float32Array
  destLon: Float32Array
  destLat: Float32Array
  values: Float32Array
  categories: Uint16Array
}

export interface FlowRecord {
  originLon: number
  originLat: number
  destLon: number
  destLat: number
  value?: number
  category?: number
}

export function flowFromRecords(records: FlowRecord[]): FlowBuffer {
  const n = records.length
  const flow: FlowBuffer = {
    length: n,
    originLon: new Float32Array(n),
    originLat: new Float32Array(n),
    destLon: new Float32Array(n),
    destLat: new Float32Array(n),
    values: new Float32Array(n),
    categories: new Uint16Array(n)
  }
  records.forEach((record, i) => {
    flow.originLon[i] = record.originLon
    flow.originLat[i] = record.originLat
    flow.destLon[i] = record.destLon
    flow.destLat[i] = record.destLat
    flow.values[i] = record.value ?? 1
    flow.categories[i] = record.category ?? 0
  })
  return flow
}

/** 轨迹缓冲：每条轨迹一条变长点序列，索引数组定位。 */
export interface TrajectoryBuffer {
  count: number
  /** 各轨迹起始点索引，长度 = count + 1。 */
  offsets: Uint32Array
  positions: Float32Array
  timestamps: Float64Array
  speeds: Float32Array
  categories: Uint16Array
}

export interface TrajectoryRecord {
  points: Array<{ lon: number; lat: number; time: number; speed?: number }>
  category?: number
}

export function trajectoryFromRecords(records: TrajectoryRecord[]): TrajectoryBuffer {
  let total = 0
  for (const record of records) total += record.points.length
  const offsets = new Uint32Array(records.length + 1)
  const positions = new Float32Array(total * 2)
  const timestamps = new Float64Array(total)
  const speeds = new Float32Array(total)
  const categories = new Uint16Array(total)
  let cursor = 0
  records.forEach((record, i) => {
    offsets[i] = cursor
    for (const point of record.points) {
      positions[cursor * 2] = point.lon
      positions[cursor * 2 + 1] = point.lat
      timestamps[cursor] = point.time
      speeds[cursor] = point.speed ?? 0
      categories[cursor] = record.category ?? 0
      cursor += 1
    }
  })
  offsets[records.length] = cursor
  return { count: records.length, offsets, positions, timestamps, speeds, categories }
}
