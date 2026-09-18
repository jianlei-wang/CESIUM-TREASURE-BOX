precision highp float;
precision highp sampler2DArray;

// 【Cesium 适配扩展（涂抹修复 T1，2026-09-02）】upscale 分母缺省 1（2026-09-02 用户定稿
// 全分 TAA 档为默认；1=全分走 TAA 分支，2/4=低分 upscale）——运行时由
// buildCloudsResolveFragmentShader defines 恒注入；此缺省保 raw source 独立编译
// 可过（GLSL ES：未定义宏参与 #if 表达式是编译错）。
#ifndef UPSCALE_DIVISOR
#define UPSCALE_DIVISOR 1
#endif // UPSCALE_DIVISOR

#include "core/turbo"
#include "catmullRomSampling"
#include "varianceClipping"

uniform sampler2D colorBuffer;
uniform sampler2D depthVelocityBuffer;
uniform sampler2D colorHistoryBuffer;

#ifdef SHADOW_LENGTH
uniform sampler2D shadowLengthBuffer;
uniform sampler2D shadowLengthHistoryBuffer;
#endif // SHADOW_LENGTH

uniform vec2 texelSize;
uniform int frame;
uniform float varianceGamma;
uniform float temporalAlpha;
uniform float temporalDisocclusion;
uniform vec2 jitterOffset;

in vec2 vUv;

layout(location = 0) out vec4 outputColor;
#ifdef SHADOW_LENGTH
layout(location = 1) out float outputShadowLength;
#endif // SHADOW_LENGTH

const ivec2 neighborOffsets[9] = ivec2[9](
  ivec2(-1, -1),
  ivec2(-1, 0),
  ivec2(-1, 1),
  ivec2(0, -1),
  ivec2(0, 0),
  ivec2(0, 1),
  ivec2(1, -1),
  ivec2(1, 0),
  ivec2(1, 1)
);

const ivec4[4] bayerIndices = ivec4[4](
  ivec4(0, 12, 3, 15),
  ivec4(8, 4, 11, 7),
  ivec4(2, 14, 1, 13),
  ivec4(10, 6, 9, 5)
);

// 【Cesium 适配扩展（涂抹修复 T1，2026-09-02）】UPSCALE_DIVISOR=2：半分 march（RT 面积 ×4，
// 细节上限 4px→2px 像素周期）下直通块从 4×4 变 2×2——16 相位 4×4 表不适用，改 2×2 Bayer
// 4 相位表 + frame%4 直通（每像素每 4 帧直通一次，逐轮消费 march 端 16 相位 jitter 的不同
// 真值）。N=4 路径（#else）保持 three 原文逐字，便于上游 diff。
#if UPSCALE_DIVISOR == 2
const int bayerIndices2[4] = int[4](0, 2, 3, 1);
#endif // UPSCALE_DIVISOR == 2

// 【2026-09-04 coverage=1 云甲内运动全黑修复：getHistoryNanGuard】history 采样含 NaN 时
// 以 current 替换。GLSL mix 为 IEEE 融合乘加——NaN·(1-α) 任意 α 均传播，NaN 一旦写入
// history 即 ping-pong 永久自持（δa rejection 的比较恒 false 拦不住、α=1 直混也无法
// 消除、刷新才清）。运动中大视差（近云深度 texel 数米位移→百 texel 级重投影）易采到
// 坏值区，故在采样后立即消毒。
vec4 sanitizeHistory(const vec4 sampled, const vec4 current) {
  if (any(isnan(sampled))) {
    return current;
  }
  return sampled;
}

vec4 getClosestFragment(const ivec2 coord) {
  // 【2026-09-03 夜间云内移动黑块修复：getClosestFragmentNoCloudGuard】云甲内视角下
  // depthVelocity.r 在「有云 texel（云距）/无云 texel（cameraFar≈1e10）」间逐像素跳变。
  // 3×3 全局最近深度会让无云 texel 借到别处云的 velocity → history 重投影错位 → 云的
  // a/rgb 拖尾成层叠鬼影（暗色块；移动时持续供错、刷新才清；夜晚 761m 复现组实证）。
  // 修=中心 texel 自身 depth 为远平面级（无样本=无云）时直接退回自身 velocity——
  // 自身即 no-hit 分支的 view-space 自洽重投影，语义最准。有云 texel 保持上游
  // closest-neighbor 行为（边缘稳定性）不变。
  vec4 centerDepthVelocity = texelFetch(depthVelocityBuffer, coord, 0);
  if (centerDepthVelocity.r >= 1e8) {
    return centerDepthVelocity;
  }
  // 【2026-09-03 coverage=1 云甲内盐粒修复：getClosestFragmentDepthHomogeneityGuard】
  // 甲内水平视角下 depthVelocity.r 在「近云数米 ↔ 甲顶球远端数百 km」间逐像素跳变
  // （合法几何值，非远平面哨兵——上述 1e8 守卫不覆盖）。全局最近深度让远端 texel 借到
  // 近云 velocity（反向错借同样存在）→ history 大距离错位；coverage=1 全屏 a≈1 →
  // |Δa| rejection 永不触发 → 满屏盐粒（temporal=0 直通同一 march buffer 平滑、
  // upscale=4 分支低分聚合深度平滑——层锁定全分 TAA 借用）。修=邻居与中心深度比
  // 超 2×（更深或更浅）视为跨层 texel 不参与 min 竞争；无同质邻居退回自身 velocity。
  // closest 边缘语义保留（同质域内仍取最近）。
  float centerDepth = centerDepthVelocity.r;
  vec4 result = centerDepthVelocity; // 缺省=自身（无同质邻居时退自身自洽重投影）
  vec4 neighbor;
  #pragma unroll_loop_start
  for (int i = 0; i < 9; ++i) {
    neighbor = texelFetchOffset(depthVelocityBuffer, coord, 0, neighborOffsets[i]);
    // 深度悬殊（>2× 或 <0.5×）= 跨层 texel，velocity 不可借。同质条件并入 min 竞争
    //（unroll 展开后无循环上下文，不能用 continue——glslang 'continue statement
    // only allowed in loops'）。
    if (neighbor.r <= centerDepth * 2.0 && centerDepth * 2.0 <= neighbor.r && neighbor.r < result.r) {
      result = neighbor;
    }
  }
  #pragma unroll_loop_end
  return result;
}

void temporalUpscale(
  const ivec2 coord,
  const ivec2 lowResCoord,
  const bool currentFrame,
  out vec4 outputColor,
  out float outputShadowLength
) {
  vec4 currentColor = texelFetch(colorBuffer, lowResCoord, 0);
  #ifdef SHADOW_LENGTH
  vec4 currentShadowLength = vec4(texelFetch(shadowLengthBuffer, lowResCoord, 0).rgb, 1.0);
  #endif // SHADOW_LENGTH

  if (currentFrame) {
    // Use the texel just rendered without any accumulation.
    outputColor = currentColor;
    #ifdef SHADOW_LENGTH
    outputShadowLength = currentShadowLength.r;
    #endif // SHADOW_LENGTH
    return;
  }

  vec4 depthVelocity = getClosestFragment(lowResCoord);
  vec2 velocity = depthVelocity.gb;
  vec2 prevUv = vUv - velocity;
  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {
    outputColor = currentColor;
    #ifdef SHADOW_LENGTH
    outputShadowLength = currentShadowLength.r;
    #endif // SHADOW_LENGTH
    return; // Rejection
  }

  // Variance clipping with a large variance gamma seems to work fine for
  // upsampling. This increases ghosting, of course, but it's hard to notice on
  // clouds.
  // vec4 historyColor = textureCatmullRom(colorHistoryBuffer, prevUv);
  vec4 historyColor = sanitizeHistory(texture(colorHistoryBuffer, prevUv), currentColor); // getHistoryNanGuard
  // 【2026-09-02 云地平线黑块修复（disocclusion rejection）】四组俯冲 A/B 定位黑块源=
  // resolve history 混合（temporal=0 / α=1 / γ=0.5 / α=0.5 全零黑块，默认参数必现）。
  // 云海地平线深度不连续处：低分 march 读 depth 带 temporalJitter，相位轮换使部分帧被
  // 地形深度切空（color=vec4(0)）写入 history；运动中 getClosestFragment 3×3 最近深度
  // 取 velocity 跨界污染 → prevUv 错位 → history 采到云/非云交界无效 texel → γ=2 宽
  // AABB（邻域亮云/透明混布方差大）剪不住 → mix(clip(history), current, 0.1) 以 90%
  // history 权重输出暗块；1/16 currentFrame 直通 texel 露出真值 = 黑块内规则白点阵
  // （用户截图同形态）。修法=TAA disocclusion 检测：current/history 云 alpha 差异超阈 =
  // 遮挡关系翻转，不信任 history 直出 current（同 prevUv 越界 rejection 路径）。阈值
  // 默认 0.5：跨云边界错采 |Δa|=1（0↔1）稳触发；云边缘正常相位噪声 |Δa|<0.3 不误杀
  // （误杀代价仅该 texel 一帧直出=可接受）。
  if (abs(currentColor.a - historyColor.a) > temporalDisocclusion) {
    outputColor = currentColor;
    #ifdef SHADOW_LENGTH
    outputShadowLength = currentShadowLength.r;
    #endif // SHADOW_LENGTH
    return; // Disocclusion rejection
  }
  vec4 clippedColor = varianceClipping(colorBuffer, vUv, currentColor, historyColor, varianceGamma);
  // 【2026-09-02 静止收敛抖动修复】three 原文 outputColor = clippedColor 直出——variance
  // clip 的 AABB 逐帧随 current(Bayer ±2px 轮换采样)移动,history 被 clip 拉向本帧
  // current → 输出跟随 current 轮换不收敛。高对比云区(近云视角)显示层持续抖动
  // (连拍 20-40% 像素逐帧变化;低对比远景/three storybook 场景不可见——分辨率×对比度
  // 放大,机制 three 同款)。修法=TAA 标准混合:输出 = mix(clip(history), current, α)
  // ——Bayer 轮换分量指数衰减(α=0.1 → 16 相位残留 0.9^16≈18%),fresh 直出帧保持
  // 超采样语义不变。
  outputColor = mix(clippedColor, currentColor, temporalAlpha);
  // 【outputColorSanityGuard】NaN 兜底：任何上游残留 NaN（含 mix 的 IEEE 传播）直出 current。
  if (any(isnan(outputColor.rgb))) {
    outputColor = currentColor;
  }

  #ifdef SHADOW_LENGTH
  // Sampling the shadow length history using scene depth doesn't make much
  // sense, but it's too hard to derive it properly. At least this approach
  // resolves the edges of scene objects.
  // vec4 historyShadowLength = vec4(textureCatmullRom(shadowLengthHistoryBuffer, prevUv).rgb, 1.0);
  vec4 historyShadowLength = vec4(texture(shadowLengthHistoryBuffer, prevUv).rgb, 1.0);
  vec4 clippedShadowLength = varianceClipping(
    shadowLengthBuffer,
    vUv,
    currentShadowLength,
    historyShadowLength,
    varianceGamma
  );
  outputShadowLength = clippedShadowLength.r;
  #endif // SHADOW_LENGTH
}

void temporalAntialiasing(const ivec2 coord, out vec4 outputColor, out float outputShadowLength) {
  vec4 currentColor = texelFetch(colorBuffer, coord, 0);
  #ifdef SHADOW_LENGTH
  vec4 currentShadowLength = vec4(texelFetch(shadowLengthBuffer, coord, 0).rgb, 1.0);
  #endif // SHADOW_LENGTH

  vec4 depthVelocity = getClosestFragment(coord);
  vec2 velocity = depthVelocity.gb;

  vec2 prevUv = vUv - velocity;
  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {
    outputColor = currentColor;
    #ifdef SHADOW_LENGTH
    outputShadowLength = currentShadowLength.r;
    #endif // SHADOW_LENGTH
    return; // Rejection
  }

  vec4 historyColor = sanitizeHistory(texture(colorHistoryBuffer, prevUv), currentColor); // getHistoryNanGuard
  // 【2026-09-03 穿云黑块修复】disocclusion rejection——312573d 只加在 temporalUpscale 分支
  // （N=4 时代默认档），1ce0d93 默认档切 N=1 走本分支后补丁丢失：穿云 velocity 跨层错位 →
  // history 采到无效 texel（黑）→ γ=2 宽 AABB 剪不住 → mix 90% 黑 history 固化扩散（傍晚
  // 穿云黑块 A/B 复现实证）。|Δa|>阈 = 云/非云遮挡关系翻转，不信任 history 直出 current。
  if (abs(currentColor.a - historyColor.a) > temporalDisocclusion) {
    outputColor = currentColor;
    #ifdef SHADOW_LENGTH
    outputShadowLength = currentShadowLength.r;
    #endif // SHADOW_LENGTH
    return; // Disocclusion rejection
  }
  vec4 clippedColor = varianceClipping(colorBuffer, coord, currentColor, historyColor);
  outputColor = mix(clippedColor, currentColor, temporalAlpha);
  // 【outputColorSanityGuard】NaN 兜底：任何上游残留 NaN（含 mix 的 IEEE 传播）直出 current。
  if (any(isnan(outputColor.rgb))) {
    outputColor = currentColor;
  }

  #ifdef SHADOW_LENGTH
  vec4 historyShadowLength = vec4(texture(shadowLengthHistoryBuffer, prevUv).rgb, 1.0);
  vec4 clippedShadowLength = varianceClipping(
    shadowLengthBuffer,
    coord,
    currentShadowLength,
    historyShadowLength
  );
  outputShadowLength = mix(clippedShadowLength.r, currentShadowLength.r, temporalAlpha);
  #endif // SHADOW_LENGTH
}

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);

  #if !defined(SHADOW_LENGTH)
  float outputShadowLength;
  #endif // !defined(SHADOW_LENGTH)

  #ifdef TEMPORAL_UPSCALE
  #if UPSCALE_DIVISOR == 2
  ivec2 lowResCoord = coord / 2;
  int bayerValue = bayerIndices2[(coord.y % 2) * 2 + (coord.x % 2)];
  bool currentFrame = bayerValue == frame % 4;
  #else // UPSCALE_DIVISOR == 2
  ivec2 lowResCoord = coord / 4;
  int bayerValue = bayerIndices[coord.x % 4][coord.y % 4];
  bool currentFrame = bayerValue == frame % 16;
  #endif // UPSCALE_DIVISOR == 2
  temporalUpscale(coord, lowResCoord, currentFrame, outputColor, outputShadowLength);
  #else // TEMPORAL_UPSCALE
  temporalAntialiasing(coord, outputColor, outputShadowLength);
  #endif // TEMPORAL_UPSCALE

  #if defined(SHADOW_LENGTH) && defined(DEBUG_SHOW_SHADOW_LENGTH)
  outputColor = vec4(turbo(outputShadowLength * 0.05), 1.0);
  #endif // defined(SHADOW_LENGTH) && defined(DEBUG_SHOW_SHADOW_LENGTH)

  #ifdef DEBUG_SHOW_VELOCITY
  outputColor.rgb = outputColor.rgb + vec3(abs(texture(depthVelocityBuffer, vUv).gb) * 10.0, 0.0);
  #endif // DEBUG_SHOW_VELOCITY
}
