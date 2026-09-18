// packages/cesium-clouds/src/glsl/weatherBake.frag
//
// WeatherAtlas 烘焙 shader（spec §5）：256²×64 切片中第 floor(u_slice×64) 层。
// 设计：
//  - 周期化铁律（spec §5.1）：全部噪声以烘焙域为周期——Worley 整频（p 空间周期 1）、
//    perlin periodic 版（rep=frequency）。
//  - 时间维扫掠（spec §5.2 主方案）：Worley 采 z=u_slice×Z_CYCLES（平面扫过 3D 特征点
//    → 云单体原生长大/缩小/消亡）；perlin 采 w=u_slice×W_CYCLES（4D 第 4 维）。
//    Z_CYCLES/W_CYCLES 必须整数——演化闭合铁律（环回绕 u_slice=0 与 1 同点）。
//  - 圆环漂移（辅助低频分量）：ringOffset = R×(cos,sin)(2π·u_slice)。
//  - 复合顺序钉死：F(p + warp(p) + ringOffset)——warp 作用于未平移 p（反向复合=纯
//    刚体平移零形变，spec BLOCKER 修订）。
//  - 第 4 通道 = extra（对齐旧图 localWeather.frag extra 语义，freq 32/4 octaves——T8 实证
//    旧 PNG 资产 A 有真实分布 mean 0.415，旧 shader 尾部 outputColor.a=1.0 覆盖系后加、
//    与资产失同步；spec §4.6「a 恒 1」前提作废，修订待 T9 勘误）。
precision highp float;
precision highp int;

#include "perlin"
#include "tileableNoise"

in vec2 vUv;

layout(location = 0) out vec4 outputColor;

uniform float u_slice;      // i/N ∈ [0,1)
uniform vec2 u_seedOffset;  // WEATHER_BAKE_SEED 派生的固定偏移（确定性，spec §4.5）

// 演化闭合整数行程（spec §5.2 铁律）
#define Z_CYCLES 4.0
#define W_CYCLES 2.0
#define EVOLVE_RADIUS 0.25
// 通道错速（spec §4.6.2「高卷云快、低云慢」物理兑现，P2 2026-09-03）：high 通道 w 维
// 演化速度 ×HIGH_W_SPEED（卷云时间尺度短于低云）。闭合铁律逐通道核算：ΔwPhase 整环
// = W_CYCLES × HIGH_W_SPEED = 4.0，perlin rep.w = W_CYCLES = 2.0 → 行程 2 个完整周期 ✓。
#define HIGH_W_SPEED 2.0
// 域扭曲：整数频率（周期化铁律）、互质防共振；warpAmp 以低云基频 cell 数标定
#define WARP_F1 3
#define WARP_F2 5
#define WARP_AMP 0.06

// vec3 特征点修正版 Worley FBM（spec §1 根因 4：tileableNoise:56 标量 hash 把特征点
// 钉在 cell 对角线——三路相位错开标量噪声合成 vec3 偏移打散，turbulence.frag 手法）。
// 返回必须 vec3 分量独立（评审 Critical：若求和成标量再广播回 (s,s,s)，修正失效且
// s∈[0,3) 超 cell 边界破坏 ±1 邻域完备性——cell 边界接缝）。
vec3 worleyFeatureOffset(const vec3 tp, const float cellCount, const float seed) {
  vec3 o = vec3(
    noise(mod(tp + seed, cellCount)),
    noise(mod(tp + seed + 17.31, cellCount)),
    noise(mod(tp + seed + 43.7, cellCount))
  );
  return o;
}

float getWorleyNoiseV3(const vec3 p, const float cellCount, const float seed) {
  vec3 cell = p * cellCount;
  float d = 1.0e10;
  for (int x = -1; x <= 1; ++x) {
    for (int y = -1; y <= 1; ++y) {
      for (int z = -1; z <= 1; ++z) {
        vec3 tp = floor(cell) + vec3(x, y, z);
        vec3 tpo = cell - tp - worleyFeatureOffset(tp, cellCount, seed);
        d = min(d, dot(tpo, tpo));
      }
    }
  }
  return clamp(d, 0.0, 1.0);
}

float getWorleyFbmV3(const vec3 p, const float freq, const float seed) {
  float amp = 0.4;
  float f = freq;
  float sum = 0.0;
  for (int i = 0; i < 4; ++i) {
    sum += amp * (1.0 - getWorleyNoiseV3(p, f, seed + float(i) * 11.3));
    f *= 2.0;
    amp *= 0.95;
  }
  return sum;
}

void main() {
  // 环回折叠（P2）：fract(1.0)=0——u_slice=1 精确等同 0，逐位闭合可严格断言
  //（否则 sin(2π×1.0) float32 残差 -3.1e-8 经 ringOffset 进入 bakePoint，闭合断言 flaky）。
  // 生产 u_atlasT ∈[0,1)（computeEvolutionTNorm posMod），fract 恒等，无行为变化。
  float slice = fract(u_slice);
  vec2 p = vUv;
  float zPhase = slice * Z_CYCLES;
  float wPhase = slice * W_CYCLES;
  float ringAngle = 6.28318530718 * slice;
  vec2 ringOffset = EVOLVE_RADIUS * vec2(cos(ringAngle), sin(ringAngle));

  // 周期化域扭曲（perlin 4D，w=wPhase 使扭曲场本身随时间演化——形变局部化）
  vec2 warpA = vec2(
    perlin(vec4(p * float(WARP_F1), 0.0, wPhase), vec4(float(WARP_F1), float(WARP_F1), 1.0, W_CYCLES)),
    perlin(vec4(p * float(WARP_F2), 0.0, wPhase), vec4(float(WARP_F2), float(WARP_F2), 1.0, W_CYCLES))
  );
  vec2 pw = p + WARP_AMP * warpA;         // warp 作用于未平移 p
  vec3 bakePoint = vec3(pw + ringOffset + u_seedOffset, zPhase + u_seedOffset.x);

  // Mid clouds（freq 8 + vec3(0.5) 相位，smoothstep(1.0,1.4)）——先算（低云挖除的减数）
  float mid = getWorleyFbmV3(bakePoint + vec3(0.5, 0.5, 0.0), 8.0, 9.2);
  mid = smoothstep(1.0, 1.4, mid);

  // Low clouds（对齐 localWeather.frag low 路线：freq 16 → smoothstep(0.8,1.4)）
  // 挖除语义：r = saturate(worley - g)——低云=中云挖除余量（低中互斥）。采样端 clouds.glsl
  // Skybolt 调制链（coverage=0.3/coverageFilterWidths=0.6，用户已验收标定）按此语义设计。
  // 沿革：brief 曾定「独立通道+max」，T8 真浏览器实证失配——调制压不住联合覆盖 →
  // 饱和白雾、单体结构丢失（60fps 透射早退假象）→ 回退旧图组合（采样端不动，controller 裁决）。
  float low = getWorleyFbmV3(bakePoint, 16.0, 1.7);
  low = smoothstep(0.8, 1.4, low);
  low = clamp(low - mid, 0.0, 1.0);

  // High clouds（perlin 4D w 维扫掠，对齐 high 路线 freq vec3(6,12,1)；wPhase×HIGH_W_SPEED
  // 通道错速——高卷云演化 2× 快于低云，spec §4.6.2 错速承诺兑现）
  float high = perlin(
    vec4(bakePoint.xy * vec2(6.0, 12.0), 0.0, wPhase * HIGH_W_SPEED + 0.3),
    vec4(6.0, 12.0, 1.0, W_CYCLES)
  );
  // 直采不加外层系数——perlin.glsl 末行已含内部 2.2×（return 2.2 * n_xyzw），外层再乘即
  // 双重放大（T8 实测 40.7% 像素 >0.9 vs 旧图 2.1%，白雾主源；旧图同为直采+smoothstep）。
  high = smoothstep(-0.5, 0.5, high);

  // Extra/第 4 通道（对齐旧图 localWeather.frag extra 逐字：freq 32.0 / 4 octaves /
  // 相位 (-19.1,33.4,47.2)，getPerlinNoise 重载在 tileableNoise.glsl:86）。
  // 采样点用 bakePoint（非旧图静态 vec3(vUv,0)）：A 与 low/mid 同域随 atlas 时间维演化，
  // 防 A 静止成跨切片 ghost overlay；zPhase 经 rep=freq 周期 z 轴无缝环回（Z_CYCLES=4
  // 整数周期闭合，与本体铁律同款）。
  float extra = getPerlinNoise(bakePoint + vec3(-19.1, 33.4, 47.2), 32.0, 4);
  extra = smoothstep(-0.5, 0.5, extra);

  outputColor = vec4(low, mid, high, extra);
}
