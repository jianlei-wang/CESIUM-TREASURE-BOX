// Reference: https://github.com/mrdoob/three.js/blob/r171/examples/jsm/csm/CSMShader.js

#ifndef SHADOW_CASCADE_COUNT
#error "SHADOW_CASCADE_COUNT macro must be defined."
#endif // SHADOW_CASCADE_COUNT

int getCascadeIndex(
  const mat4 viewMatrix,
  const vec3 worldPosition,
  const vec2 intervals[SHADOW_CASCADE_COUNT],
  const float near,
  const float far
) {
  vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
  float depth = viewZToOrthographicDepth(viewPosition.z, near, far);
  vec2 interval;
  #pragma unroll_loop_start
  for (int i = 0; i < 4; ++i) {
    #if UNROLLED_LOOP_INDEX < SHADOW_CASCADE_COUNT
    interval = intervals[i];
    if (depth >= interval.x && depth < interval.y) {
      return UNROLLED_LOOP_INDEX;
    }
    #endif // UNROLLED_LOOP_INDEX < SHADOW_CASCADE_COUNT
  }
  #pragma unroll_loop_end
  // 末层 fallback：仅当 depth 仍在 BSM 覆盖内（< 1.0 = far）——超出返回 -1（BSM 覆盖外，
  // 与 getFadedCascadeIndex 的远端上界语义一致；调用方须处理 -1）。
  if (depth >= 1.0) {
    return -1;
  }
  return SHADOW_CASCADE_COUNT - 1;
}

int getFadedCascadeIndex(
  const mat4 viewMatrix,
  const vec3 worldPosition,
  const vec2 intervals[SHADOW_CASCADE_COUNT],
  const float near,
  const float far,
  const float jitter
) {
  vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
  float depth = viewZToOrthographicDepth(viewPosition.z, near, far);

  vec2 interval;
  float intervalCenter;
  float closestEdge;
  float margin;
  int nextIndex = -1;
  int prevIndex = -1;
  float alpha;

  #pragma unroll_loop_start
  for (int i = 0; i < 4; ++i) {
    #if UNROLLED_LOOP_INDEX < SHADOW_CASCADE_COUNT
    interval = intervals[i];
    intervalCenter = (interval.x + interval.y) * 0.5;
    closestEdge = depth < intervalCenter ? interval.x : interval.y;
    margin = closestEdge * closestEdge * 0.5;
    interval += margin * vec2(-0.5, 0.5);

    #if UNROLLED_LOOP_INDEX < SHADOW_CASCADE_COUNT - 1
    if (depth >= interval.x && depth < interval.y) {
      prevIndex = nextIndex;
      nextIndex = UNROLLED_LOOP_INDEX;
      alpha = saturate(min(depth - interval.x, interval.y - depth) / margin);
    }
    #else // UNROLLED_LOOP_INDEX < SHADOW_CASCADE_COUNT - 1
    // Don't fade out the last cascade —— 但加远端上界（depth < 1.0 = shadowFar）：
    // Cesium 全球尺度下云可视距离（maxRayDistance 200km）≫ BSM 有效距离，超出 shadowFar 的
    // 云若 light-space xy 落在末层 ortho 盒内（uv 合法）会采样到错位 BSM 内容 → 远端云面
    // 异常深色斑（屏幕锚定、随相机前进；2026-08-28 用户实测）。three 原版场景视距≈阴影 far，
    // 无此暴露。越界点循环无匹配 → 返回 -1 → 消费端 fallback 光深 0（无自阴影）。
    // alpha 含远端 fade-out 项（1.0 - depth）：depth→1.0 时 alpha→0 → jitter 走 prevIndex
    // （末层区间内 prevIndex=-1 → 无阴影）——jitter dither 渐变过渡，替代硬边界（相机移动时
    // shadowFar 边界在云面扫过，硬切会逐帧翻转闪烁；fade 带宽 = margin，与层间 fade 同机制）。
    if (depth >= interval.x && depth < 1.0) {
      prevIndex = nextIndex;
      nextIndex = UNROLLED_LOOP_INDEX;
      alpha = saturate(min(depth - interval.x, 1.0 - depth) / margin);
    }
    #endif // UNROLLED_LOOP_INDEX < SHADOW_CASCADE_COUNT - 1
    #endif // UNROLLED_LOOP_INDEX < SHADOW_CASCADE_COUNT
  }
  #pragma unroll_loop_end

  return jitter <= alpha
    ? nextIndex
    : prevIndex;
}
