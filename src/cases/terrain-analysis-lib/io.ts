/**
 * DEM 文件导入：支持 GeoTIFF（含投影自动转 WGS84）与高度图/灰度影像。
 */
import { fromArrayBuffer } from 'geotiff'
import proj4 from 'proj4'
import { demFromHeightmap, finalizeDem } from './dem'
import type { DemData } from './types'

const MAX_DIM = 512

export type ImportOptions = {
  fallbackBounds: { west: number; east: number; south: number; north: number }
  minHeight: number
  maxHeight: number
}

function downscale(src: ArrayLike<number>, w: number, h: number): { pixels: Float32Array; cols: number; rows: number } {
  const sx = w > MAX_DIM ? Math.ceil(w / MAX_DIM) : 1
  const sy = h > MAX_DIM ? Math.ceil(h / MAX_DIM) : 1
  const cols = Math.max(2, Math.floor(w / sx))
  const rows = Math.max(2, Math.floor(h / sy))
  const pixels = new Float32Array(cols * rows)
  for (let y = 0; y < rows; y += 1) {
    const srcRow = Math.min(h - 1, sy * y)
    for (let x = 0; x < cols; x += 1) {
      const srcX = Math.min(w - 1, sx * x)
      const v = Number(src[srcRow * w + srcX])
      pixels[y * cols + x] = Number.isFinite(v) ? v : Number.NaN
    }
  }
  return { pixels, cols, rows }
}

async function parseGeoTiff(ab: ArrayBuffer, fallback: ImportOptions): Promise<DemData> {
  const tiff = await fromArrayBuffer(ab)
  const image = await tiff.getImage()
  const w = image.getWidth()
  const h = image.getHeight()
  const rawResult = (await image.readRasters({ samples: [0], interleave: true })) as unknown as {
    samples: ArrayLike<number>[]
  }
  const raw = rawResult.samples[0]
  const nodataRaw = image.getGDALNoData()
  const nodata = nodataRaw === null || nodataRaw === undefined ? NaN : Number(nodataRaw)
  const { pixels, cols, rows } = downscale(raw, w, h)
  if (Number.isFinite(nodata)) {
    for (let i = 0; i < pixels.length; i += 1) {
      if (Math.abs(pixels[i] - nodata) < 1e-6) pixels[i] = Number.NaN
    }
  }

  const bbox = image.getBoundingBox()
  let west = bbox[0]
  let south = bbox[1]
  let east = bbox[2]
  let north = bbox[3]
  const keys = (image.getGeoKeys ? image.getGeoKeys() : {}) as Record<string, number>
  const epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey
  if (epsg && epsg !== 4326) {
    try {
      const p1 = proj4(`EPSG:${epsg}`, 'EPSG:4326', [bbox[0], bbox[1]])
      const p2 = proj4(`EPSG:${epsg}`, 'EPSG:4326', [bbox[2], bbox[3]])
      west = Math.min(p1[0], p2[0])
      east = Math.max(p1[0], p2[0])
      south = Math.min(p1[1], p2[1])
      north = Math.max(p1[1], p2[1])
    } catch {
      west = fallback.fallbackBounds.west
      east = fallback.fallbackBounds.east
      south = fallback.fallbackBounds.south
      north = fallback.fallbackBounds.north
    }
  }
  if (!Number.isFinite(west) || east - west <= 0 || north - south <= 0) {
    west = fallback.fallbackBounds.west
    east = fallback.fallbackBounds.east
    south = fallback.fallbackBounds.south
    north = fallback.fallbackBounds.north
  }
  return finalizeDem(pixels, cols, rows, west, east, south, north, `导入 GeoTIFF ${cols}x${rows}`)
}

async function parseImage(file: File, options: ImportOptions): Promise<DemData> {
  const bitmap = await createImageBitmap(file)
  const sx = Math.min(MAX_DIM / bitmap.width, MAX_DIM / bitmap.height, 1)
  const w = Math.max(2, Math.floor(bitmap.width * sx))
  const h = Math.max(2, Math.floor(bitmap.height * sx))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  bitmap.close?.()
  const b = options.fallbackBounds
  return demFromHeightmap(data, w, h, w, h, options.minHeight, options.maxHeight, b.west, b.east, b.south, b.north, `导入高度图 ${w}x${h}`)
}

export async function importDemFile(file: File, options: ImportOptions): Promise<DemData> {
  if (/\.(tif|tiff|gtiff)$/i.test(file.name)) {
    const ab = await file.arrayBuffer()
    return parseGeoTiff(ab, options)
  }
  return parseImage(file, options)
}
