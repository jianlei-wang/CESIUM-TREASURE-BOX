// depthTemporal EMA 参数（评审钉死，见 spec v2 §5）。
// EMA 在 raw log-depth 域；运动门控 position+direction 双项 + 高度归一化。

export const LOW_ALPHA = 0.05 // 静止强累积（history 主导，强平滑）
export const HIGH_ALPHA = 0.5 // 移动偏 current（比 ShadowResolvePass 0.8 低，因 reprojection 更准可承受更多累积）
export const DEPTH_THRESHOLD_DEFAULT = 0.1 // log-depth 相对阈值（|histLog-curLog|/curLog，距离无关容差 ≈ 7% 距离变化）
export const MAX_DELTA_K = 0.01 // maxDelta = altitudeAboveGround * MAX_DELTA_K（离地高度归一化，1km 离地→10m，Bug2）
export const MIN_CAMERA_HEIGHT_M = 1000 // camera 低 maxDelta 下限（防地表 altitudeAboveGround→0，Bug2）
export const DIRECTION_WEIGHT = 0.5 // 运动门控 direction 项权重（reprojection 准，比 ShadowResolvePass 调小）
export const FOG_PLANE_LOGDEPTH_EPS = 1e-4 // 远平面判定：curLogDepth >= 1 - eps → 不累积

export interface TemporalQualityPreset {
  lowAlpha: number
  highAlpha: number
}

// URL ?temporalQuality=low|high（收敛调参，替代 v1 的 lowAlpha/highAlpha/temporalAlpha 三参）
export const TEMPORAL_QUALITY_PRESETS: Record<'low' | 'high', TemporalQualityPreset> = {
  low: { lowAlpha: 0.05, highAlpha: 0.5 }, // 默认：强平滑
  high: { lowAlpha: 0.1, highAlpha: 0.8 }, // 弱平滑（减拖影，适合快速操作）
}
