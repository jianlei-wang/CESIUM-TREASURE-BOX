// Three.js `<common>` chunk 兼容桩（spec §4.2：GLSL 资产层不得出现 czm_* 或 Three 标识符）。
//
// 背景：three-geospatial 的 clouds shader 源里写了 `#include <common>`（Three.js 运行时注入的
// 通用 chunk）。移植到 Cesium 后运行时没有 Three 的 chunk 注入管线，故由本桩提供 clouds 实际
// 用到的常量。仅覆盖 clouds shader 真实引用的符号（PI / TWO_PI / PI2 / HALF_PI /
// RECIPROCAL_PI / RECIPROCAL_PI2 / EPSILON），其余 Three <common> 符号（saturate 由 core/math
// 提供；pow2/max3 等 clouds 未用）一律不重复定义，避免与 core/math 冲突。
//
// 全部 #if !defined 守卫——允许 clouds assembler prefix 或 core/math 提前定义同名宏时静默跳过。
#if !defined(PI)
#define PI 3.141592653589793
#endif // !defined(PI)

#if !defined(TWO_PI)
#define TWO_PI 6.283185307179586
#endif // !defined(TWO_PI)

// clouds.frag sampleShadowOpticalDepthPCF 用 interleavedGradientNoise(...) * PI2
#if !defined(PI2)
#define PI2 6.283185307179586
#endif // !defined(PI2)

#if !defined(HALF_PI)
#define HALF_PI 1.5707963267948966
#endif // !defined(HALF_PI)

// clouds.glsl getSphericalUv / clouds.frag henyeyGreenstein ground bounce
#if !defined(RECIPROCAL_PI)
#define RECIPROCAL_PI 0.3183098861837907
#endif // !defined(RECIPROCAL_PI)

// clouds.glsl getSphericalUv
#if !defined(RECIPROCAL_PI2)
#define RECIPROCAL_PI2 0.15915494309189535
#endif // !defined(RECIPROCAL_PI2)

#if !defined(EPSILON)
#define EPSILON 1e-6
#endif // !defined(EPSILON)
