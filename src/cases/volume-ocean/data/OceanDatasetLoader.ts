/// <reference types="vite/client" />
/**
 * 数据集加载器 —— 拉取清单、静态体与逐月数据块
 *
 * 二进制布局（小端）：
 *   coords.bin     : 头 nx,ny,nz 各 uint32 → lon f32×nx → lat f32×ny → depth f32×nz
 *   bathymetry.bin : f32×nx×ny（正值向下，海底深度，索引 idx = x + nx*y）
 *   mask.bin       : uint8×nx×ny×nz（索引 idx = x + nx*(y + ny*z)）
 *   frames/MM.bin  : 按 varOrder 依次 uint16×nx×ny×nz，value = raw*scale + offset，
 *                    raw==missingValue 或 mask==0 记为 NaN（缺测/陆地下方）。
 */

import { parseDatasetManifest } from './ocean-dataset.schema'
import type { OceanDatasetManifest, OceanStoredVariable } from '../ocean-tsd.types'

export interface OceanDatasetStatic {
  manifest: OceanDatasetManifest
  lons: Float32Array
  lats: Float32Array
  depths: Float32Array
  bathymetry: Float32Array
  mask: Uint8Array
}

export interface OceanFrameData {
  timeIndex: number
  values: Record<OceanStoredVariable, Float32Array>
}

function joinUrl(base: string, ...parts: string[]): string {
  const prefix = base.endsWith('/') ? base : `${base}/`
  const tail = parts
    .map((p) => p.replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter(Boolean)
    .join('/')
  return `${prefix}${tail}`
}

function datasetUrl(dataDir: string, file: string): string {
  const base = import.meta.env.BASE_URL ?? '/'
  return joinUrl(base, dataDir, file)
}

async function fetchArrayBuffer(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`数据请求失败（${response.status} ${response.statusText}）：${url}`)
  }
  return response.arrayBuffer()
}

/** 读取并校验清单 */
export async function loadManifest(dataDir: string, signal?: AbortSignal): Promise<OceanDatasetManifest> {
  const buffer = await fetchArrayBuffer(datasetUrl(dataDir, 'manifest.json'), signal)
  const text = new TextDecoder('utf-8').decode(buffer)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`清单 JSON 解析失败：${dataDir}/manifest.json`)
  }
  const manifest = parseDatasetManifest(parsed)
  if (manifest.files.frames.length !== manifest.timeLabels.length) {
    throw new Error('数据块数量与时间标签数量不一致')
  }
  return manifest
}

/** 加载静态体：坐标轴、海底地形、掩膜 */
export async function loadStatic(
  dataDir: string,
  manifest: OceanDatasetManifest,
  signal?: AbortSignal
): Promise<OceanDatasetStatic> {
  const { nx, ny, nz } = manifest.grid
  const [coordsBuf, bathyBuf, maskBuf] = await Promise.all([
    fetchArrayBuffer(datasetUrl(dataDir, manifest.files.coords), signal),
    fetchArrayBuffer(datasetUrl(dataDir, manifest.files.bathymetry), signal),
    fetchArrayBuffer(datasetUrl(dataDir, manifest.files.mask), signal)
  ])

  const coordsView = new DataView(coordsBuf)
  const headerNx = coordsView.getUint32(0, true)
  const headerNy = coordsView.getUint32(4, true)
  const headerNz = coordsView.getUint32(8, true)
  if (headerNx !== nx || headerNy !== ny || headerNz !== nz) {
    throw new Error('coords.bin 头维度与清单不一致')
  }

  let offset = 12
  const lons = new Float32Array(coordsBuf.slice(offset, offset + nx * 4))
  offset += nx * 4
  const lats = new Float32Array(coordsBuf.slice(offset, offset + ny * 4))
  offset += ny * 4
  const depths = new Float32Array(coordsBuf.slice(offset, offset + nz * 4))

  if (bathyBuf.byteLength !== nx * ny * 4) throw new Error('bathymetry.bin 长度与网格不一致')
  if (maskBuf.byteLength !== nx * ny * nz) throw new Error('mask.bin 长度与网格不一致')

  return {
    manifest,
    lons,
    lats,
    depths,
    bathymetry: new Float32Array(bathyBuf),
    mask: new Uint8Array(maskBuf)
  }
}

/** 加载单月数据块（含掩膜），解算为物理量，NaN 表示缺测 */
export async function loadFrame(
  dataDir: string,
  manifest: OceanDatasetManifest,
  mask: Uint8Array,
  timeIndex: number,
  signal?: AbortSignal
): Promise<OceanFrameData> {
  if (timeIndex < 0 || timeIndex >= manifest.files.frames.length) {
    throw new Error(`时间索引越界：${timeIndex}`)
  }
  const { nx, ny, nz } = manifest.grid
  const planar = nx * ny * nz
  const buffer = await fetchArrayBuffer(datasetUrl(dataDir, manifest.files.frames[timeIndex]), signal)
  const raw = new Uint16Array(buffer)
  const varCount = manifest.varOrder.length
  if (raw.length !== planar * varCount) throw new Error('数据块长度与网格 / 变量数不一致')
  if (mask.length !== planar) throw new Error('掩膜长度与网格不一致')

  const values: Partial<Record<OceanStoredVariable, Float32Array>> = {}
  manifest.varOrder.forEach((variable, order) => {
    const meta = manifest.variables[variable]
    const out = new Float32Array(planar)
    const base = order * planar
    for (let i = 0; i < planar; i += 1) {
      const r = raw[base + i]
      out[i] = r === meta.missingValue || mask[i] === 0 ? NaN : r * meta.scale + meta.offset
    }
    values[variable] = out
  })

  return { timeIndex, values: values as Record<OceanStoredVariable, Float32Array> }
}
