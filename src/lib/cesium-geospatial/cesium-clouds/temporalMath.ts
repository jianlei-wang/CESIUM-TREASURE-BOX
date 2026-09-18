// temporalMath.ts
//
// M4 T1：temporal resolve 的 TS 侧数学——Bayer 4×4 相位表 + jitter 计算 + reprojection 矩阵。
// 逐字对齐 three-geospatial/packages/clouds/src/bayer.ts 与 CloudsMaterial.ts:337-368
// （copyCameraSettings 的 temporalUpscale 分支），供 createCloudsStage preRender 每帧调用。
//
// 量纲约定（three 同款）：
//   - bayerOffsets 单位 [0,1]（4×4 格中心，(i%4+0.5)/4）
//   - temporalJitter 单位 = 低分 UV（(offset-0.5)/lowRes）——three 原式
//     dx = ((offset.x-0.5)/resolution.x)*4，resolution=lowRes*4 → 化简 (offset.x-0.5)/lowResW
//   - jitter 进投影矩阵：column2.xy += jitter*2（column-major 下 col2.x/y 即 three
//     elements[8]/[9]——NDC 平移项 x_w 系数；×2 因 NDC 域 [-1,1] 而 jitter 是 UV 域）

import { Cartesian2, Cartesian4, Matrix4 } from 'cesium'

// prettier-ignore
export const bayerIndices: readonly number[] = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5
]

/** 帧 i（%16）的 Bayer 采样偏移（4×4 格中心，单位 [0,1]）。three bayer.ts 同款反查构造。 */
export const bayerOffsets: readonly Cartesian2[] = bayerIndices.reduce<Cartesian2[]>(
  (result, _, index) => {
    const offset = new Cartesian2()
    for (let i = 0; i < 16; ++i) {
      if (bayerIndices[i] === index) {
        // Cartesian2 无 set 方法（three Vector2 才有）——直接字段赋值
        offset.x = ((i % 4) + 0.5) / 4
        offset.y = (Math.floor(i / 4) + 0.5) / 4
        break
      }
    }
    result.push(offset)
    return result
  },
  []
)

/**
 * 计算本帧 march jitter（低分 UV 单位，写入 params.temporalJitter → shader 三处消费：
 * ray 重建 gl_FragCoord 偏移 / depth 采样 UV / 噪声种子）。
 */
export function computeTemporalJitter(
  frame: number,
  lowResWidth: number,
  lowResHeight: number,
  result: Cartesian2
): Cartesian2 {
  const offset = bayerOffsets[frame % 16]
  result.x = (offset.x - 0.5) / lowResWidth
  result.y = (offset.y - 0.5) / lowResHeight
  return result
}

/** 上帧相机快照（preRender 存，下帧算 velocity 用）。 */
export interface TemporalCameraSnapshot {
  viewMatrix: Matrix4
  projectionMatrix: Matrix4
}

const columnScratch = new Cartesian4()

/**
 * 组装 reprojection 矩阵（clouds.frag velocity 两分支消费）：
 *
 *   reprojectionMatrix     = (prevP + jitter) * prevV        ← hitClouds 分支（world/ECEF 路径）
 *   viewReprojectionMatrix = reprojectionMatrix * invCurV    ← scene/ground 分支（view 路径，精度好）
 *
 * jitter 写入 prevP column2.xy（×2：NDC 域）；首帧 previous=undefined 时 fallback 当前 P/V
 * （velocity=0，three CloudsMaterial previousProjectionMatrix ?? camera.projectionMatrix 同款）。
 *
 * Cesium 适配（M4 plan D5）：矩阵域是 ECEF 世界坐标（worldToECEF=identity，viewMatrix 即相机
 * ECEF→view）；preRender 时刻 frustum.projectionMatrix 为完整视锥（multi-frustum 分段前）；
 * velocity 数学只用投影 xy 系数与 w，与 near/far 分段无关 → 分段执行下依然正确。
 */
export function buildReprojectionMatrices(
  previous: TemporalCameraSnapshot | undefined,
  currentViewMatrix: Matrix4,
  currentProjectionMatrix: Matrix4,
  currentInverseViewMatrix: Matrix4,
  jitter: Cartesian2,
  result: { reprojectionMatrix: Matrix4; viewReprojectionMatrix: Matrix4 }
): void {
  const prevP = previous?.projectionMatrix ?? currentProjectionMatrix
  const prevV = previous?.viewMatrix ?? currentViewMatrix

  // jitteredPrevP：clone 后改 column2
  Matrix4.clone(prevP, result.reprojectionMatrix)
  const col = Matrix4.getColumn(result.reprojectionMatrix, 2, columnScratch)
  col.x += jitter.x * 2
  col.y += jitter.y * 2
  Matrix4.setColumn(result.reprojectionMatrix, 2, col, result.reprojectionMatrix)

  // reprojectionMatrix = jitteredPrevP * prevV
  Matrix4.multiply(result.reprojectionMatrix, prevV, result.reprojectionMatrix)
  // viewReprojectionMatrix = reprojectionMatrix * currentInverseView
  Matrix4.multiply(
    result.reprojectionMatrix,
    currentInverseViewMatrix,
    result.viewReprojectionMatrix
  )
}

// ── T2 运动自适应 α（2026-09-02 涂抹+抖动修复）────────────────────────────────
// 相机运动中 resolve 的 history 重投影错位（低分 velocity 误差）+ 直通像素块内轮换 =
// 「快速抖动」感知源；history 权重（1-α）越高拖影/错位越持久。运动中把 α 升高
// → 输出更贴本帧低分 march（拖影换细颗粒噪声，感知更稳）；静止回到 base α 收敛。
// 阈值单位 m/帧（30m/帧 ≈ 1800m/s @60fps 的快速平移量级）。
/** 运动启动阈值（m/帧）：低于此值视为静止/微动，α 保持 base（保护静止收敛）。 */
export const MOTION_ALPHA_START_M = 1
/** 全速阈值（m/帧）：高于此值 α 直达 motionAlpha 上限。 */
export const MOTION_ALPHA_FULL_M = 300
/** 旋转→等效平移换算半径（m/弧度）：方向变化 1 弧度 ≈ 5km 等效位移（云距量级）。 */
export const MOTION_EQUIV_RADIUS_M = 5000
/** 每帧 α 向目标的 lerp 系数：0.25 → 约 9 帧到达 95%，防 α 阶跃本身引入闪动。 */
export const MOTION_ALPHA_LERP = 0.25

/**
 * 运动标量（m/帧）→ 本帧 α（含向目标的 lerp 平滑）。
 *
 * @param motionM 运动标量（平移距离 + 方向角变化 × MOTION_EQUIV_RADIUS_M）。
 * @param baseAlpha 静止 α（= params.temporalAlpha，缺省 0.1）。
 * @param motionAlpha 运动中 α 上限（= params.motionAlpha，缺省 0.4）。
 * @param prevAlpha 上帧输出 α（首帧传 baseAlpha）。
 */
export function computeMotionAlpha(
  motionM: number,
  baseAlpha: number,
  motionAlpha: number,
  prevAlpha: number
): number {
  const t = Math.min(
    1,
    Math.max(0, (motionM - MOTION_ALPHA_START_M) / (MOTION_ALPHA_FULL_M - MOTION_ALPHA_START_M))
  )
  const smooth = t * t * (3 - 2 * t) // smoothstep
  const target = baseAlpha + (motionAlpha - baseAlpha) * smooth
  return prevAlpha + (target - prevAlpha) * MOTION_ALPHA_LERP
}
