// phase2b LensFlare 常量表（逐字 three-geospatial WebGL LensFlareEffect + spec §5 标定）。
// bloom 级数可配置（减法阶段降 NUM_BLOOM_LEVELS）。

// 文档性常量：当前 createLensFlareStage 用硬编码 DOWNSAMPLE/UPSAMPLE_SCALES 数组；
// 减法阶段降级（如移动端砍级）时接线让它驱动 scale 数组生成。
export const NUM_BLOOM_LEVELS = 6 // threshold(get0) + down0-4（到 textureScale 1/32），spec §3

// 9 ghost offset + tint（逐字 three-geospatial lensFlareFeatures.frag，spec §1.4 表）
// GHOST_OFFSETS[6]：原 1.0 致 suv=1-uv+(uv-0.5)×1.0=0.5 全屏恒定（数学奇点）——所有像素采屏幕中心，
// 正对太阳时全盘叠加太阳 HDR → 全盘白。改 0.9 消除奇点（suv 随 uv 变化，ghost 回到正常反射位置）。
export const GHOST_OFFSETS: number[] = [-5.0, -1.5, -0.4, -0.2, -0.1, 0.7, 0.9, 2.5, 10.0]
export const GHOST_TINTS: [number, number, number][] = [
  [0.8, 0.8, 1.0], [1.0, 0.8, 0.4], [0.9, 1.0, 0.8], [1.0, 0.8, 0.4], [0.9, 0.7, 0.7],
  [0.5, 1.0, 0.4], [0.5, 0.5, 0.5], [1.0, 1.0, 0.6], [0.5, 0.8, 1.0]
]

export const HALO_RADIUS = 0.45
export const HALO_THICKNESS = 0.25
export const HALO_DISPLACEMENT = 0.3
export const CHROMATIC_ABERRATION = 10.0

export const UPSAMPLE_RADIUS = 0.85
export const DEPTH_EPSILON = 1e-6
export const OCCLUSION_TEXTURE_SCALE = 0.0625 // occlusion 标量降分（spec §3，空间常数全分浪费）

export const LEARNOGLY_DOWNSAMPLE_WEIGHTS = {
  center: 0.125, innerCorner: 0.125, edgeMid: 0.0625, outerCorner: 0.03125
}
export const CODAW_DOWNSAMPLE_WEIGHTS = { inner: 0.125, outer: 0.05556 }
export const UPSAMPLE_WEIGHTS = { center: 0.25, edge: 0.125, corner: 0.0625 }

export const THRESHOLD_LEVEL_DEFAULT = 3.0
export const THRESHOLD_RANGE_DEFAULT = 1.0
export const INTENSITY_DEFAULT = 0.001 // ghost/bloom 总强度（用户验收：0.01→0.005→0.001 逐步更透明）
export const GHOST_AMOUNT_DEFAULT = 0.05
export const HALO_AMOUNT_DEFAULT = 0.05
