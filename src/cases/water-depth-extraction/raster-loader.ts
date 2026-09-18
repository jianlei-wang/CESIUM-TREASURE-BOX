import { fromArrayBuffer } from 'geotiff'
import proj4 from 'proj4'
import type { DepthGrid, SourceExtent } from './terrain-sampler'

const MAX_DIM = 1024

function clampIndex(v: number, max: number): number {
  return Math.max(0, Math.min(max - 1, v))
}

function downscaleRaster(src: ArrayLike<number>, w: number, h: number): { pixels: Float32Array; cols: number; rows: number } {
  const sx = w > MAX_DIM ? Math.ceil(w / MAX_DIM) : 1
  const sy = h > MAX_DIM ? Math.ceil(h / MAX_DIM) : 1
  const cols = Math.floor(w / sx)
  const rows = Math.floor(h / sy)
  const pixels = new Float32Array(cols * rows)
  for (let y = 0; y < rows; y += 1) {
    const srcRow = sy * y
    for (let x = 0; x < cols; x += 1) {
      const srcX = sx * x
      pixels[y * cols + x] = Number(src[srcRow * w + srcX]) || 0
    }
  }
  return { pixels, cols, rows }
}

function rasterStats(pixels: Float32Array): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < pixels.length; i += 1) {
    const v = pixels[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min)) min = 0
  if (!Number.isFinite(max)) max = min + 1
  return { min, max }
}

async function parseGeoTiff(ab: ArrayBuffer): Promise<{ grid: DepthGrid; extent: SourceExtent; projected: boolean }> {
  const tiff = await fromArrayBuffer(ab)
  const image = await tiff.getImage()
  const w = image.getWidth()
  const h = image.getHeight()
  const rawResult = (await image.readRasters({ samples: [0], interleave: true })) as unknown as {
    width: number
    height: number
    samples: Array<ArrayLike<number>>
  }
  const raw = rawResult.samples[0]
  const nodataRaw = image.getGDALNoData()
  const nodata = nodataRaw === null || nodataRaw === undefined ? NaN : Number(nodataRaw)
  const { pixels, cols, rows } = downscaleRaster(raw, w, h)
  if (Number.isFinite(nodata)) {
    for (let i = 0; i < pixels.length; i += 1) {
      if (Math.abs(pixels[i] - nodata) < 1e-6) pixels[i] = 0
    }
  }
  const stats = rasterStats(pixels)
  const bbox = image.getBoundingBox()
  let west = bbox[0]
  let south = bbox[1]
  let east = bbox[2]
  let north = bbox[3]
  let projected = false
  const keys = image.getGeoKeys ? image.getGeoKeys() : {}
  const epsg = (keys && (keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey)) as number | undefined
  if (epsg && epsg !== 4326 && typeof proj4 === 'function') {
    try {
      const p1 = proj4(`EPSG:${epsg}`, 'EPSG:4326', [bbox[0], bbox[1]])
      const p2 = proj4(`EPSG:${epsg}`, 'EPSG:4326', [bbox[2], bbox[3]])
      const allLons = [p1[0], p2[0]]
      const allLats = [p1[1], p2[1]]
      west = Math.min(...allLons)
      east = Math.max(...allLons)
      south = Math.min(...allLats)
      north = Math.max(...allLats)
      projected = true
    } catch (e) {
      // 未知投影：保留原始 bbox，按 WGS84 处理
    }
  }
  return { grid: { cols, rows, pixels, ...stats }, extent: { west, south, east, north }, projected }
}

async function parseImageFile(file: File, maxDim = 512): Promise<{ pixels: Float32Array; cols: number; rows: number; normalized: boolean }> {
  const bitmap = await createImageBitmap(file)
  const sx = Math.min(maxDim / bitmap.width, maxDim / bitmap.height, 1)
  const w = Math.max(2, Math.floor(bitmap.width * sx))
  const h = Math.max(2, Math.floor(bitmap.height * sx))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const pixels = new Float32Array(w * h)
  for (let i = 0; i < w * h; i += 1) {
    pixels[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3 / 255
  }
  bitmap.close?.()
  return { pixels, cols: w, rows: h, normalized: true }
}

export type RasterSource = {
  grid: DepthGrid
  extent?: SourceExtent
  isImage: boolean
  name: string
}

export async function parseRasterFile(file: File): Promise<RasterSource> {
  if (/\.(tif|tiff)$/i.test(file.name)) {
    const ab = await file.arrayBuffer()
    const { grid, extent } = await parseGeoTiff(ab)
    return { grid, extent, isImage: false, name: file.name }
  }
  const out = await parseImageFile(file)
  const { cols, rows, pixels } = out
  return {
    grid: { cols, rows, pixels, ...rasterStats(pixels) },
    isImage: true,
    name: file.name
  }
}
