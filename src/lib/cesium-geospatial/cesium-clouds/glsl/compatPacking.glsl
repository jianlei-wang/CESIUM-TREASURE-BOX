// Three.js `<packing>` chunk 兼容桩（spec §4.2：GLSL 资产层不得出现 czm_* 或 Three 标识符）。
//
// 背景：three-geospatial 的 clouds.frag 写了 `#include <packing>`（Three.js 运行时注入）。
// clouds shader 与 core/cascadedShadowMaps.glsl 共用到 4 个 depth↔viewZ 换算函数：
//   - perspectiveDepthToViewZ / orthographicDepthToViewZ：clouds.frag getViewZ
//   - viewZToOrthographicDepth：core/cascadedShadowMaps.getCascadeIndex/getFadedCascadeIndex
// Three <packing> 其余符号（unpackRGBAToDepth / packDepthToRGBA 等）clouds 链路未引用，不定义。
// 注意：core/glsl/packing.glsl 是法线 packing（packNormalToVec2），与此处 depth packing 无关。
//
// 实现逐字对齐 Three.js r170 `<packing>` chunk（mit license）——仅取 clouds 链路用到的子集。

// 透视投影：NDC depth（0..1，WebGL）→ view space Z（负值，相机前方）。
float perspectiveDepthToViewZ(const float depth, const float near, const float far) {
  // 远平面 clip → perspective divide 还原；与 Three.js <packing> 完全一致。
  return near * far / ((far - near) * depth - far);
}

// 正交投影：NDC depth（0..1）→ view space Z。
float orthographicDepthToViewZ(const float depth, const float near, const float far) {
  return (near + far) * 0.5 - depth * (far - near) * 0.5;
}

// 透视投影逆：view space Z → NDC depth。
float viewZToPerspectiveDepth(const float viewZ, const float near, const float far) {
  return ((far + viewZ) * near) / (near - far);
}

// 正交投影逆：view space Z → NDC depth。core/cascadedShadowMaps 级联划分用。
float viewZToOrthographicDepth(const float viewZ, const float near, const float far) {
  return (viewZ + near) / (near - far);
}
