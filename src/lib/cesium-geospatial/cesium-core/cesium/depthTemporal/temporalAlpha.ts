// 运动门控：position + direction 双项 + 高度归一化。
// 评审 critical：旧 ShadowResolvePass 只检测 positionDelta，旋转/orbit 时 positionDelta 小但画面大变 → 旁路门控 → 拖影。
// direction 项（1 - dot(dir, prevDir)）补这个缺口：旋转/orbit 必走高 alpha（偏 current）。
import { DIRECTION_WEIGHT, MAX_DELTA_K, MIN_CAMERA_HEIGHT_M } from './depthTemporalConstants'

export interface TemporalAlphaInput {
  cameraHeight: number
  maxDelta: number // cameraHeight * MAX_DELTA_K（高度归一化，1Mm → 10km）
  positionDelta: number // distance(positionWC, prevPositionWC)，平移量
  directionDelta: number // 1 - dot(directionWC, prevDir)，旋转量（0=同向，2=反向）
  lowAlpha: number
  highAlpha: number
}

// 标准 smoothstep（GLSL 内建不可在 TS 用，本地实现）。
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// 计算 EMA 时变 alpha：静止 → lowAlpha（强平滑/history 主导）→ 运动 → highAlpha（偏 current/减拖影）。
// motion = positionDelta/maxDelta + DIRECTION_WEIGHT * directionDelta（position 项归一化到 maxDelta，高度自适应）。
export function computeTemporalAlpha(input: TemporalAlphaInput): number {
  const motion =
    input.positionDelta / input.maxDelta + DIRECTION_WEIGHT * input.directionDelta
  const t = smoothstep(0, 1, motion)
  return input.lowAlpha + (input.highAlpha - input.lowAlpha) * t
}

// maxDelta 归一化：用离地高度（cameraHeight - earthRadius），非地心距（Bug2 修复）。
//
// 原实现 maxDelta = cameraHeight(地心距) * K：camera 低 camR≈6371km → maxDelta=63.7km → 平移 1km
// motion=0.016 → alpha≈0.053（几乎全 history）→ smoothDist 滞后 → camera 低 inscatter 拖影/丢失。
// 门控为高空标定（注释「1Mm→10km」印证），camera 低完全失效——与 EMA 域无关（解释 window-depth EMA 也失败）。
//
// 修复：maxDelta = 离地高度 * K。camera 低（5km height）→ maxDelta≈50m → 平移 1km 触发 highAlpha（防滞后）。
// earthRadius 用 ellipsoid.maximumRadius（赤道，保守下限）——极区 cameraHeight<maximumRadius 时 altitudeAboveGround
// 为负，max(..., MIN_CAMERA_HEIGHT_M) 兜底（地表 maxDelta=10m，平移 10m 触发 highAlpha，合理）。
//
// 诊断来源：三专家评审 eye-space-ema spec（专家3 C1 motion 门控失效 + CPU 验证 cameraHeight=地心距）。
export function computeMaxDelta(cameraHeight: number, earthRadius: number): number {
  const altitudeAboveGround = Math.max(cameraHeight - earthRadius, MIN_CAMERA_HEIGHT_M)
  return altitudeAboveGround * MAX_DELTA_K
}
