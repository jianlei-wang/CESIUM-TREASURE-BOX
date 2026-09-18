// sunQuantization.ts
//
// 太阳方向量化（spec v3 §3.1.8）：仅作用于 BSM 矩阵构造输入（light 基/snap/跳过判据），
// march 与消费端保持精确 sunDirection。ECEF 单位球网格量化（球坐标 theta/phi 各 snap），
// 跨 ICRF/GMST-fallback 分支一致（比量化时间直接）。demo 时钟静止时 sunDirection 恒定
// → 量化零触发；跑钟跨步频率 ≈ 0.05°/(15°/h) ≈ 每 12s 一次。
import { Cartesian3 } from 'cesium'

/** 量化步长 rad（0.05°，spec §3.1.8）。 */
export const SUN_QUANT_STEP = 8.7e-4

/**
 * ECEF 单位球网格量化：theta = acos(z)、phi = atan2(y,x) 各 snap 到 step 网格后重建。
 * 太阳赤纬带 |dec|<23.4° 不经极区（theta≈0 处 phi 退化无害——向量连续）。
 */
export function quantizeSunDirection(
  direction: Cartesian3,
  step: number,
  result: Cartesian3
): Cartesian3 {
  const theta = Math.acos(Math.min(1, Math.max(-1, direction.z)))
  const phi = Math.atan2(direction.y, direction.x)
  const qTheta = Math.round(theta / step) * step
  const qPhi = Math.round(phi / step) * step
  const sinT = Math.sin(qTheta)
  return Cartesian3.fromElements(
    sinT * Math.cos(qPhi),
    sinT * Math.sin(qPhi),
    Math.cos(qTheta),
    result
  )
}
