// phase2b LensFlare occlusion 纯函数（spec §5.5）。
// 三函数均为无 Cesium 依赖的纯函数（number[]/tuple），便于 node 单测；
// shader 内（occlusion.frag.ts, T8）用 czm_view/czm_projection/czm_viewerPositionWC 自动注入。
//
// 矩阵约定：number[16]，列主（对齐 Cesium Matrix4 / WebGL mat4 / GLSL mat4）。
//   元素 m[col*4 + row]；mat4*vec4：
//     result.x = m[0]*v.x + m[4]*v.y + m[8]*v.z  + m[12]*v.w
//     result.y = m[1]*v.x + m[5]*v.y + m[9]*v.z  + m[13]*v.w
//     result.z = m[2]*v.x + m[6]*v.y + m[10]*v.z + m[14]*v.w
//     result.w = m[3]*v.x + m[7]*v.y + m[11]*v.z + m[15]*v.w
//
// vec3 用 [number, number, number] 元组（非 Cartesian3，避免 Cesium 依赖便于单测）。

/** 列主 4×4 矩阵 × vec4 → vec4（内部辅助，不导出）。 */
function mat4Vec4(
  m: number[],
  v: [number, number, number, number],
): [number, number, number, number] {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ]
}

/**
 * sun 世界空间方向 → 屏幕空间 UV（spec §5.5 §1）。
 *
 * 关键：sunEC = view * vec4(sunDirectionWC, 0.0)（w=0，无穷远方向）。
 *   - w=0 剔除 view 的平移列，等价「仅旋转」——修 cesium-clouds-atmosphere 1e6 视差 bug
 *     （其把 sun 当 1e6 米远点，相机移动 1e3 米会产生可见视差，但日地距 1.5e11 米无视差）。
 *   - 第二步 sunClip = projection * vec4(sunEC.xyz, 1.0)（w=1 点投影），获得 clip 空间。
 *
 * @param sunDirectionWC  太阳世界方向（单位向量；world space）
 * @param cameraPositionWC 相机世界位置（保留参数，w=0 投影下不参与 sun 投影计算；
 *                          shader 内供 rayEllipsoidIntersect 的 ray origin 使用）
 * @param view            列主 4×4 view 矩阵（对应 GLSL czm_view）
 * @param projection      列主 4×4 projection 矩阵（对应 GLSL czm_projection）
 * @returns [u, v] in [0,1]，或 null（sunClip.w<=0 背面 / NDC 超出 [-1,1] 不在屏内）
 */
export function computeSunScreenUV(
  sunDirectionWC: [number, number, number],
  cameraPositionWC: [number, number, number],
  view: number[],
  projection: number[],
): [number, number] | null {
  void cameraPositionWC // w=0 方向投影：相机位置不影响 sun 屏幕位置（spec §5.5 §1 注）
  // sunEC = view * vec4(sunDirectionWC, 0.0)（w=0 无穷远方向）
  const sunEC = mat4Vec4(view, [sunDirectionWC[0], sunDirectionWC[1], sunDirectionWC[2], 0.0])
  // sunClip = projection * vec4(sunEC.xyz, 1.0)
  const sunClip = mat4Vec4(projection, [sunEC[0], sunEC[1], sunEC[2], 1.0])
  // 背面 / 裁剪面后（w<=0）→ null
  if (sunClip[3] <= 0) return null
  // 透视除法 → NDC
  const ndcX = sunClip[0] / sunClip[3]
  const ndcY = sunClip[1] / sunClip[3]
  // NDC 超出 [-1,1] → 不在视椎屏内 → null
  if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) return null
  // NDC → UV（屏幕纹理坐标）
  return [ndcX * 0.5 + 0.5, ndcY * 0.5 + 0.5]
}

/**
 * 射线-WGS84 椭球求交（spec §5.5 §2 / M9 椭球，非球）。
 *
 * 椭球方程 (x/a)² + (y/b)² + (z/c)² = 1。射线 P(t)=ro+t·rd 代入：
 *   Σ((ro_i + t·rd_i)²/r_i²) = 1
 *   ⇒ [Σ rd_i²/r_i²] t² + [2·Σ ro_i·rd_i/r_i²] t + [Σ ro_i²/r_i² - 1] = 0
 *   ⇒ A t² + B t + C = 0
 *
 * @param ro  射线原点（world space，通常 = 相机位置）
 * @param rd  射线方向（world space，单位向量）
 * @param ellipsoidRadiiSquared  椭球三轴半径平方 [a², b², c²]
 * @returns 入口点 t（最近正根），或 -1（判别式<0 不交，或 t<0 在背面/背离）
 *
 * 注：occlusion 场景相机始终在椭球外，t0=(-B-√D)/(2A) 为入口点；t0<0 时（射线背离或
 * 起点在椭球内）返回 -1。起点在椭球内的退化情形（地下）不属 occlusion 正常工况。
 */
export function rayEllipsoidIntersect(
  ro: [number, number, number],
  rd: [number, number, number],
  ellipsoidRadiiSquared: [number, number, number],
): number {
  const [rx, ry, rz] = ellipsoidRadiiSquared
  // 二次方程系数
  const A = (rd[0] * rd[0]) / rx + (rd[1] * rd[1]) / ry + (rd[2] * rd[2]) / rz
  const B = 2 * ((ro[0] * rd[0]) / rx + (ro[1] * rd[1]) / ry + (ro[2] * rd[2]) / rz)
  const C = (ro[0] * ro[0]) / rx + (ro[1] * ro[1]) / ry + (ro[2] * ro[2]) / rz - 1
  // 判别式
  const disc = B * B - 4 * A * C
  if (disc < 0) return -1 // 不交
  // 最近根（入口点）
  const t = (-B - Math.sqrt(disc)) / (2 * A)
  if (t < 0) return -1 // 背后 / 背离
  return t
}

/**
 * 生成 6×6 = 36 点采样网格（spec §5.5 §3 / I5）。
 *
 * 用于 sun 屏幕位置周围的 depth 覆盖率采样。6×6 = 36 点步进 ~2.7%（vs 4×4=16 点 6.25%
 * 步进台阶），平滑度更优；配合 tonemap dithering 可进一步打散残留台阶。
 *
 * @returns 36 个 [x, y] 点，x/y ∈ [-1, 1]（i/5*2-1，i=0→-1，i=5→+1，含四角与中心带）
 */
export function generateSampleGrid36(): [number, number][] {
  const points: [number, number][] = []
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const x = (i / 5) * 2 - 1 // [-1, 1]：i=0→-1, i=5→+1
      const y = (j / 5) * 2 - 1
      points.push([x, y])
    }
  }
  return points
}
