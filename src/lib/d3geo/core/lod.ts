/**
 * 全模块统一的 LOD（多细节层次）能力。
 *
 * 所有案例共用同一个 `createGeoLOD`，避免各案例自行实现 `resForHeight()`，
 * 保证「相机高度 → 聚合分辨率」的映射在模块内一致。
 */

export type GeoLODLevel = {
  /** 相机高度 <= 该阈值时命中本层（从上到下递减）。 */
  maxHeight: number
  /** 本层的聚合分辨率（H3 res / 网格边长 / 分级编号）。 */
  resolution: number
  /** 展示标签，如 `H3 res 3`。 */
  label: string
}

export type GeoLOD = {
  /** 原始层定义，按 maxHeight 升序。 */
  levels: GeoLODLevel[]
  /** 根据相机高度选择层级。 */
  resolve: (height: number) => GeoLODLevel
  /** 层级序号（0 = 最粗）。 */
  indexOf: (height: number) => number
  /** 下一层（更细）；已到最细返回自身。 */
  next: (height: number) => GeoLODLevel
  /** 上一层（更粗）；已到最粗返回自身。 */
  prev: (height: number) => GeoLODLevel
}

export function createGeoLOD(levels: GeoLODLevel[]): GeoLOD {
  const sorted = [...levels].sort((a, b) => a.maxHeight - b.maxHeight)
  const resolve = (height: number): GeoLODLevel => {
    for (const level of sorted) if (height <= level.maxHeight) return level
    return sorted[sorted.length - 1]
  }
  const indexOf = (height: number): number => sorted.indexOf(resolve(height))
  return {
    levels: sorted,
    resolve,
    indexOf,
    next: (height) => sorted[Math.min(sorted.length - 1, indexOf(height) + 1)],
    prev: (height) => sorted[Math.max(0, indexOf(height) - 1)]
  }
}

/** H3 多尺度默认层级表：全球 → 国家 → 省 → 城市 → 街区 → 局部网格。 */
export const H3_LOD_LEVELS: GeoLODLevel[] = [
  { maxHeight: 20_000_000, resolution: 1, label: 'H3 res 1 · 全球' },
  { maxHeight: 8_000_000, resolution: 2, label: 'H3 res 2 · 大洲' },
  { maxHeight: 3_500_000, resolution: 3, label: 'H3 res 3 · 国家' },
  { maxHeight: 1_500_000, resolution: 4, label: 'H3 res 4 · 省' },
  { maxHeight: 600_000, resolution: 5, label: 'H3 res 5 · 城市' },
  { maxHeight: 250_000, resolution: 6, label: 'H3 res 6 · 城区' },
  { maxHeight: 90_000, resolution: 7, label: 'H3 res 7 · 街区' },
  { maxHeight: 30_000, resolution: 8, label: 'H3 res 8 · 局部网格' }
]

export const h3LOD = createGeoLOD(H3_LOD_LEVELS)

/** 屏幕空间网格层级表：像素尺度决定聚合单元。 */
export const SCREEN_LOD_LEVELS: GeoLODLevel[] = [
  { maxHeight: 20_000_000, resolution: 64, label: '64 px 单元' },
  { maxHeight: 5_000_000, resolution: 48, label: '48 px 单元' },
  { maxHeight: 1_000_000, resolution: 32, label: '32 px 单元' },
  { maxHeight: 300_000, resolution: 20, label: '20 px 单元' },
  { maxHeight: 0, resolution: 12, label: '12 px 单元' }
]

export const screenLOD = createGeoLOD(SCREEN_LOD_LEVELS)
