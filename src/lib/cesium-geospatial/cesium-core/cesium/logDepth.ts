// Cesium 对数深度反演与视角坐标重建。
//
// 正算（Cesium czm_writeLogDepth，见 cesium Build 中 writeLogDepth.glsl）：
//   gl_FragDepth = log2(d) / log2(far - near + 1)
//   d = 视轴深度（-z_eye）- near + 1（近平面处 d=1；沿视轴递增，非径向距离）
// 注意：不可照搬 three.js 的 reverseLogDepth（公式不同）；
// Cesium 中也不存在 czm_logDepthConfig，没有 0.01 之类的缩放系数。

// GLSL：Cesium 版对数深度反演 + viewPosition 反投影。
export const LOG_DEPTH_GLSL = `
// 反演 czm_writeLogDepth：对数 windowZ → 视轴深度 -z_eye 的正值（米；沿视轴，非径向距离）。
float czm_reverseLogDepthDist(const float logDepth, const float near, const float far) {
  float d = pow(2.0, logDepth * log2(far - near + 1.0));
  return d + near - 1.0;
}

// 反演 czm_writeLogDepth：对数 windowZ → 视角深度 z_eye（负值，米）。
float czm_reverseLogDepthEye(const float logDepth, const float near, const float far) {
  return -czm_reverseLogDepthDist(logDepth, near, far);
}

// 反演 czm_writeLogDepth：对数 windowZ → 线性 windowZ（[0,1]）。
float czm_reverseLogDepthWindow(const float logDepth, const float near, const float far) {
  float zDist = czm_reverseLogDepthDist(logDepth, near, far);
  // windowZ = a + b / zDist，a/b 由透视投影推出：
  float a = far / (far - near);
  float b = far * near / (near - far);
  return a + b / zDist;
}

// 用 czm_inverseProjection 反投影：uv + 线性 windowZ → 视角坐标。
vec3 reconstructViewPosition(const vec2 uv, const float windowZ) {
  vec2 ndc = uv * 2.0 - 1.0;
  vec4 clip = vec4(ndc, windowZ * 2.0 - 1.0, 1.0);
  vec4 view = czm_inverseProjection * clip;
  return view.xyz / view.w;
}
`

// CPU 纯函数（单测用），与 GLSL czm_reverseLogDepthWindow 同式。
// 输入对数 windowZ，返回线性 windowZ（[0,1]）。
export function reverseLogDepthWindow(
  logDepth: number,
  near: number,
  far: number
): number {
  const d = Math.pow(2, logDepth * Math.log2(far - near + 1))
  const zDist = d + near - 1 // 视轴深度 -z_eye（米，正值）
  const a = far / (far - near)
  const b = (far * near) / (near - far)
  return a + b / zDist
}

// CPU 纯函数：对数 windowZ → 视轴深度 -z_eye 的正值（米；沿视轴，非径向距离）。
export function reverseLogDepthDist(
  logDepth: number,
  near: number,
  far: number
): number {
  return Math.pow(2, logDepth * Math.log2(far - near + 1)) + near - 1
}
