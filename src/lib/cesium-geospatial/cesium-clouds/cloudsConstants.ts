// 体积云默认常量（spec r1 §7 选型表 + CloudLayers 搬 three-geospatial CloudLayers.ts）

// 默认质量档（spec r1 §7：high = lightShafts on / shapeDetail on / maxIter 500 / 3 cascade / mapSize 512）。
// 对标 three 版 qualityPresets.ts 默认（high），桌面高端 60fps 目标。
export const CLOUDS_DEFAULT_QUALITY = 'high' as const

// 云层高度（单位 m；结构搬 three-geospatial CloudLayers.ts:30）。
// 2026-09-04 缺省重定（用户「云层整体偏低」）：低积云/中积云 750/1000 → 1500/2000m
// （温带积云典型云底；卷云 7500m 物理位置不动）。只读展示用，权威缺省在 cloudLayersPacking.ts。
export const CLOUDS_LAYER_ALTITUDES_M = [1500, 2000, 7500] as const
