/**
 * 数据集清单（manifest.json）运行时校验
 *
 * 数据来源、分辨率、时间范围、缺测值必须齐备，缺失或类型错误时抛错，
 * 避免用不完整的元数据静默渲染，也满足“数据须有来源/分辨率/时间范围/缺测值”的要求。
 */

import type { OceanDatasetManifest, OceanStoredVariable } from '../ocean-tsd.types'

const STORED_VARIABLES: OceanStoredVariable[] = ['temperature', 'salinity', 'u', 'v']

function fail(path: string, message: string): never {
  throw new Error(`数据集清单校验失败：${path} ${message}`)
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, '必须为非空字符串')
  return value as string
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, '必须为有限数值')
  return value as number
}

function requireNumberArray(value: unknown, path: string, expected?: number): number[] {
  if (!Array.isArray(value)) fail(path, '必须为数组')
  const arr = value as unknown[]
  if (expected !== undefined && arr.length !== expected) fail(path, `长度必须为 ${expected}`)
  return arr.map((entry, i) => requireNumber(entry, `${path}[${i}]`))
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(path, '必须为数组')
  return (value as unknown[]).map((entry, i) => requireString(entry, `${path}[${i}]`))
}

/** 校验并规范化数据集清单，返回带类型的对象 */
export function parseDatasetManifest(input: unknown): OceanDatasetManifest {
  if (!input || typeof input !== 'object') fail('root', '必须为对象')
  const raw = input as Record<string, unknown>

  const grid = raw.grid as Record<string, unknown> | undefined
  if (!grid || typeof grid !== 'object') fail('grid', '缺失')
  const nx = requireNumber(grid.nx, 'grid.nx')
  const ny = requireNumber(grid.ny, 'grid.ny')
  const nz = requireNumber(grid.nz, 'grid.nz')
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || !Number.isInteger(nz) || nx < 2 || ny < 2 || nz < 2) {
    fail('grid', '维度必须为 ≥2 的整数')
  }
  const encoding = grid.encoding === 'uint16' || grid.encoding === 'float32' ? grid.encoding : fail('grid.encoding', '仅支持 uint16 或 float32')

  const nativeResolution = raw.nativeResolution as Record<string, unknown> | undefined
  if (!nativeResolution || typeof nativeResolution !== 'object') fail('nativeResolution', '缺失')
  const depthsM = requireNumberArray(nativeResolution.depthsM, 'nativeResolution.depthsM', nz)
  for (let i = 1; i < depthsM.length; i += 1) {
    if (depthsM[i] <= depthsM[i - 1]) fail('nativeResolution.depthsM', '必须严格递增')
  }

  const variablesRaw = raw.variables as Record<string, unknown> | undefined
  if (!variablesRaw || typeof variablesRaw !== 'object') fail('variables', '缺失')
  const variables: OceanDatasetManifest['variables'] = {}
  for (const key of STORED_VARIABLES) {
    const v = variablesRaw[key] as Record<string, unknown> | undefined
    if (!v || typeof v !== 'object') fail(`variables.${key}`, '缺失')
    const validMin = requireNumber(v.validMin, `variables.${key}.validMin`)
    const validMax = requireNumber(v.validMax, `variables.${key}.validMax`)
    if (validMax <= validMin) fail(`variables.${key}`, 'validMax 必须大于 validMin')
    variables[key] = {
      sourceVariable: requireString(v.sourceVariable, `variables.${key}.sourceVariable`),
      label: requireString(v.label, `variables.${key}.label`),
      unit: requireString(v.unit, `variables.${key}.unit`),
      scale: requireNumber(v.scale, `variables.${key}.scale`),
      offset: requireNumber(v.offset, `variables.${key}.offset`),
      validMin,
      validMax,
      missingValue: requireNumber(v.missingValue, `variables.${key}.missingValue`)
    }
  }

  const varOrderRaw = raw.varOrder
  if (!Array.isArray(varOrderRaw)) fail('varOrder', '必须为数组')
  const varOrder = (varOrderRaw as unknown[]).map((entry, i) => {
    const key = requireString(entry, `varOrder[${i}]`)
    if (!STORED_VARIABLES.includes(key as OceanStoredVariable)) fail(`varOrder[${i}]`, '为未知变量')
    return key as OceanStoredVariable
  })

  const extentRaw = raw.extent as Record<string, unknown> | undefined
  if (!extentRaw || typeof extentRaw !== 'object') fail('extent', '缺失')
  const extent = {
    west: requireNumber(extentRaw.west, 'extent.west'),
    south: requireNumber(extentRaw.south, 'extent.south'),
    east: requireNumber(extentRaw.east, 'extent.east'),
    north: requireNumber(extentRaw.north, 'extent.north')
  }
  if (extent.east <= extent.west || extent.north <= extent.south) fail('extent', 'east/north 必须大于 west/south')

  const filesRaw = raw.files as Record<string, unknown> | undefined
  if (!filesRaw || typeof filesRaw !== 'object') fail('files', '缺失')

  const timeLabels = requireStringArray(raw.timeLabels, 'timeLabels')
  if (timeLabels.length === 0) fail('timeLabels', '不能为空')

  const timeKind = raw.timeKind
  const allowedTimeKind = ['observation', 'reanalysis', 'monthly-climatology', 'demo']
  if (typeof timeKind !== 'string' || !allowedTimeKind.includes(timeKind)) {
    fail('timeKind', `必须为 ${allowedTimeKind.join(' / ')} 之一`)
  }

  const depthRangeM = requireNumberArray(raw.depthRangeM, 'depthRangeM', 2) as [number, number]
  const bathymetryRangeM = requireNumberArray(raw.bathymetryRangeM, 'bathymetryRangeM', 2) as [number, number]
  for (const [name, range] of [['depthRangeM', depthRangeM], ['bathymetryRangeM', bathymetryRangeM]] as const) {
    if (range[1] <= range[0]) fail(name, '第二个元素必须大于第一个')
  }

  return {
    id: requireString(raw.id, 'id'),
    title: requireString(raw.title, 'title'),
    source: requireString(raw.source, 'source'),
    productId: requireString(raw.productId, 'productId'),
    sourceUrl: requireString(raw.sourceUrl, 'sourceUrl'),
    sourceVersion: typeof raw.sourceVersion === 'string' ? raw.sourceVersion : undefined,
    citation: requireString(raw.citation, 'citation'),
    license: requireString(raw.license, 'license'),
    generatedAt: requireString(raw.generatedAt, 'generatedAt'),
    timeKind: timeKind as OceanDatasetManifest['timeKind'],
    timeNote: requireString(raw.timeNote, 'timeNote'),
    timeLabels,
    regionName: requireString(raw.regionName, 'regionName'),
    extent,
    nativeResolution: {
      lonLat: requireString(nativeResolution.lonLat, 'nativeResolution.lonLat'),
      verticalLevels: requireNumber(nativeResolution.verticalLevels, 'nativeResolution.verticalLevels'),
      depthsM
    },
    grid: { nx, ny, nz, encoding },
    verticalPositive: 'down',
    depthRangeM,
    bathymetryRangeM,
    densityMethod: requireString(raw.densityMethod, 'densityMethod'),
    variables,
    varOrder,
    files: {
      coords: requireString(filesRaw.coords, 'files.coords'),
      bathymetry: requireString(filesRaw.bathymetry, 'files.bathymetry'),
      mask: requireString(filesRaw.mask, 'files.mask'),
      frames: requireStringArray(filesRaw.frames, 'files.frames')
    }
  }
}
