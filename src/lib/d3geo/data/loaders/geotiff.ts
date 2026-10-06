/**
 * GeoTIFF / 栅格 → 点缓冲。用于把真实栅格观测（DEM、遥感指数）接入分析层。
 */
import { fromArrayBuffer } from 'geotiff'
import { GeoPointBufferBuilder, type GeoPointBuffer } from '../../core/buffer'

export type GeoTiffOptions = {
  /** 采样波段，默认 0。 */
  band?: number
  /** 最大采样点数（按行/列步长抽稀），默认 200000。 */
  maxPoints?: number
  /** 忽略低于该值的像元（如 NoData），默认 -Infinity。 */
  noData?: number
}

/** 将 GeoTIFF 栅格按网格抽样为带值点（经纬度）。 */
export async function parseGeoTiffPoints(buffer: ArrayBuffer, options: GeoTiffOptions = {}): Promise<GeoPointBuffer> {
  const tiff = await fromArrayBuffer(buffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  const [minX, minY, maxX, maxY] = image.getBoundingBox()
  const [raster] = await image.readRasters()
  const band = (raster as unknown as ArrayLike<number>) ?? null
  if (!band) return new GeoPointBufferBuilder(0).build()

  const maxPoints = options.maxPoints ?? 200_000
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / maxPoints)))
  const noData = options.noData ?? Number.NEGATIVE_INFINITY
  const builder = new GeoPointBufferBuilder(Math.ceil((width / stride) * (height / stride)))
  for (let y = 0; y < height; y += stride) {
    const lat = maxY - ((y + 0.5) / height) * (maxY - minY)
    for (let x = 0; x < width; x += stride) {
      const value = Number(band[y * width + x])
      if (!Number.isFinite(value) || value <= noData) continue
      const lon = minX + ((x + 0.5) / width) * (maxX - minX)
      builder.push(lon, lat, value, 0, 0)
    }
  }
  return builder.build()
}
