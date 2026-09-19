/**
 * 结果导出：Float32 GeoTIFF（栅格）与 SHP/GeoJSON（矢量）。
 * GeoTIFF 编码器与 ZIP/SHP 组帧复用 hydro-analysis-pro 的成熟实现。
 */
import {
  buildGeoJson,
  buildShpZip,
  downloadBytes,
  downloadText,
  writeGeoTiffFloat32,
  type GeoTiffRaster,
  type HydFeature,
  type HydFeatureKind
} from '../hydro-analysis-pro/export-formats'
import type { DemData } from './types'

export type { HydFeature, HydFeatureKind, GeoTiffRaster }
export { buildGeoJson, buildShpZip, downloadBytes, downloadText, writeGeoTiffFloat32 }

export function demGeoTiffRaster(dem: DemData, values: Float32Array, description: string): GeoTiffRaster {
  return {
    width: dem.width,
    height: dem.height,
    west: dem.west,
    north: dem.north,
    cellLon: (dem.east - dem.west) / dem.width,
    cellLat: (dem.north - dem.south) / dem.height,
    values,
    description
  }
}

export function exportRasterGeoTiff(dem: DemData, values: Float32Array, filename: string, description: string): void {
  const bytes = writeGeoTiffFloat32(demGeoTiffRaster(dem, values, description))
  downloadBytes(bytes, filename, 'image/tiff')
}

export function exportVectorShp(name: string, features: HydFeature[]): void {
  const bytes = buildShpZip(name, features)
  if (bytes.length === 0) return
  downloadBytes(bytes, `${name}.zip`, 'application/zip')
}

export function exportPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }, 'image/png')
}
