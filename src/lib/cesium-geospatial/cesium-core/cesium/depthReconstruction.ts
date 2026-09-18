// GLSL 片段：从 depthTexture 重建 ECEF 世界坐标。
// 用 czm_inverseProjection 反投影 NDC → eye，czm_inverseView → world(ECEF)。
// 多视锥深度语义（czm_currentFrustum 分段）在 G2 验证时钉死；
// MVP 先 logarithmicDepthBuffer=false 单视锥。
export const DEPTH_RECONSTRUCTION_GLSL = `
vec3 reconstructWorldPositionECEF(sampler2D depthTexture, vec2 uv) {
  float depth = texture(depthTexture, uv).r;
  vec2 ndc = uv * 2.0 - 1.0;
  vec4 eyeCoord = czm_inverseProjection * vec4(ndc, depth * 2.0 - 1.0, 1.0);
  eyeCoord /= eyeCoord.w;
  vec4 worldCoord = czm_inverseView * eyeCoord;
  return worldCoord.xyz;
}

float linearDepth01(sampler2D depthTexture, vec2 uv) {
  float depth = texture(depthTexture, uv).r;
  float near = czm_currentFrustum.x;
  float far = czm_currentFrustum.y;
  float ndc = depth * 2.0 - 1.0;
  return (2.0 * near * far) / (far + near - ndc * (far - near)) / far;
}
`

// CPU 纯函数（供单测验证反投影数学）
export function reconstructNDCFromWindow(
  uv: [number, number],
  depth: number
): [number, number, number] {
  return [uv[0] * 2 - 1, uv[1] * 2 - 1, depth * 2 - 1]
}

export function linearDepth01CPU(
  depth: number,
  near: number,
  far: number
): number {
  const ndc = depth * 2 - 1
  const linear = (2 * near * far) / (far + near - ndc * (far - near))
  return linear / far
}
