// cloudsDefaultParameters.ts
//
// M2 T2：clouds.frag + parameters.glsl 业务 uniform 默认值（flat 标量/向量，不含 struct——
// ATMOSPHERE / densityProfile 经 CloudsMaterial.ts const 注入，不经 uniformMap）。
//
// 值来源（逐字对齐 three-geospatial）：
//   - 参与 medium / weather / shape 参数：three-geospatial/uniforms.ts createCloudParameterUniforms
//   - raymarch 参数（maxIterationCount 等）：qualityPresets.ts defaults（= high 档）
//   - scatter 视觉参数（skyLightScale/powderScale 等）：CloudsMaterial.ts:212-215
//   - 云层 packed 向量（minLayerHeights/densityScales 等）：CloudLayers.DEFAULT（CloudLayers.ts:31-68）
//     经 packValues / packSums / packIntervalHeights（uniforms.ts:124-186）展开
//   - BSM 参数（shadowMatrices/shadowIntervals 等）：M3 T4 起 state.shadow（CascadedShadowMaps +
//     ShadowPass 产出）覆盖；本表值仅 fallback（shadowMarch 档是 ShadowPass 生成端参数，T5 绑定）
//
// 纯数据模块（无 Cesium 依赖，除 Cartesian2/3/4/Matrix4 类型）→ node 单测可直接断言。
// 参数化：createCloudsStage 透传 options 覆盖默认（M6 qualityPresets 用）。

import { Cartesian2, Cartesian3, Cartesian4, Matrix4 } from 'cesium'
import type { Texture3D } from 'cesium'
import { DEFAULT_CLOUD_LAYERS, packLayerUniforms } from './cloudLayersPacking'

/**
 * BSM 生成端（ShadowPass）march 档（three-geospatial qualityPresets.ts defaults.shadow 逐字）。
 * shadow.frag 消费 maxIterationCount/minStepSize/maxStepSize/opticalDepthTailScale +
 * parameters.glsl 通用 march 终止阈值（minDensity/minExtinction/minTransmittance）。
 * T5 在 createCloudsStage 组 ShadowPass uniformMap 时展开绑定。
 */
export interface CloudsShadowMarchParameters {
  maxIterationCount: number
  minStepSize: number
  maxStepSize: number
  minDensity: number
  minExtinction: number
  minTransmittance: number
  opticalDepthTailScale: number
}

/**
 * M3 BSM 每帧状态（createCloudsStage preRender 填；CloudsPass uniformMap 闭包读引用）。
 * 值来源：CascadedShadowMaps.update（matrices/intervals/cameraNear/far）+ ShadowPass（bsm）。
 * 未就绪（首帧前 / shadow 未填）时 CloudsPass fallback dummy（Beer=1 降级）。
 */
export interface CloudsShadowFrameState {
  /** [3]：cascades[i].matrix（world→light clip）→ shadowMatrices uniform。 */
  matrices: Matrix4[]
  /** [3]：cascades[i].interval（归一化视深切分）→ shadowIntervals uniform。 */
  intervals: Cartesian2[]
  /** BSM split 用的完整视锥 near（preRender 时刻值）→ u_shadowCameraNear uniform（≠ czm_currentFrustum.x 分段值）。 */
  cameraNear: number
  /** BSM far（shadowFar uniform 同源 = CascadedShadowMaps.far）。 */
  far: number
  /** BSM 单 texel 尺寸 1/mapSize → shadowTexelSize uniform。 */
  texelSize: Cartesian2
  /** ShadowPass.bsmTexture（首帧 render 前 undefined → fallback dummy）。 */
  bsm: Texture3D | undefined
}

/** 气候带 band 下限缺省值（= 原 clouds.glsl clamp 字面量 0.2——u_climateBandsFloor 缺省零回归）。 */
export const CLIMATE_BANDS_FLOOR_DEFAULT = 0.2
/** 气候带 band 下限预设值（spec §5.4 组合语义：天气预设激活时 clamp ≥0.6——「阴天」预设 ×
 *  副热带谷不退化为近晴空；setWeatherPreset 写 state.climateBandsFloor，清除恢复缺省）。 */
export const CLIMATE_BANDS_FLOOR_PRESET = 0.6

/**
 * M2 clouds 业务 uniform 默认值（flat，struct 已 const 注入）。
 *
 * 分组（对齐 clouds.frag + parameters.glsl 声明顺序）：
 *   - 相机/场景（cameraHeight/resolution/frame/targetUvScale/mipLevelScale）
 *   - 大气（bottomRadius/worldToECEFMatrix/ecefToWorldMatrix/altitudeCorrection/sunDirection）
 *   - 参与 medium（scatteringCoefficient/absorptionCoefficient）
 *   - 主 raymarch（maxIterationCount/minStepSize/...）
 *   - 次 raymarch（maxIterationCountToSun/...）
 *   - scatter 视觉（skyLightScale/powderScale/...）
 *   - weather/shape（coverage/localWeatherRepeat/shapeRepeat/...）
 *   - 云层 packed（minLayerHeights/densityScales/...）
 *   - BSM dummy（shadowMatrices/shadowIntervals/...，M3 接通）
 *   - reprojection dummy（reprojectionMatrix/viewReprojectionMatrix/temporalJitter，M4 接通）
 *   - depth dummy（depthBuffer 占位，M6 接通真实 globe depthTexture）
 *
 * 注：cameraHeight/altitudeCorrection/sunDirection/resolution 是每帧可变量，createCloudsPass
 * 用闭包读 scene/state，本表的值仅作 fallback / 静态量。
 */
export interface CloudsParameters {
  // ── 相机/场景（每帧由 createCloudsPass 闭包覆盖）──
  /** frame 计数（M2 固定 0；M4 temporal 接通后递增）。 */
  frame: number
  /** targetUvScale：M2 全分（1,1）；M4 1/4 分 march 时 (0.25, 0.25)。 */
  targetUvScale: Cartesian2
  /** mipLevelScale：texture mip 级别缩放（three CloudsMaterial 默认 1）。 */
  mipLevelScale: number

  // ── 大气（bottomRadius 静态；altitudeCorrection/sunDirection 每帧由闭包覆盖）──
  /** bottomRadius：密切球底半径 km（= ATMOSPHERE.bottomRadius = 6360，METER_TO_LENGTH_UNIT 换算后）。 */
  bottomRadius: number
  /** worldToECEFMatrix：M2 ECEF 直采（identity）；M6 密切球再中心化时由 scene 算。 */
  worldToECEFMatrix: Matrix4
  /** ecefToWorldMatrix：M2 identity（worldToECEFMatrix 逆）。 */
  ecefToWorldMatrix: Matrix4

  // ── 参与 medium ──
  scatteringCoefficient: number
  absorptionCoefficient: number

  // ── 主 raymarch（qualityPresets high 档）──
  maxIterationCount: number
  minStepSize: number
  maxStepSize: number
  maxRayDistance: number
  perspectiveStepScale: number
  /**
   * 【2026-09-04 甲内近水平 march LOD】云内步 mip 调制倍率（clouds.frag u_hitStepMipBoost）。
   * 缺省 1=空区步同款调制；>1 更激进（远云步长更快吃满 maxStepSize）。undefined 时
   * CloudsPass 绑定兜底 1。
   */
  hitStepMipBoost?: number
  minDensity: number
  minExtinction: number
  minTransmittance: number

  // ── 次 raymarch（qualityPresets high 档）──
  maxIterationCountToSun: number
  maxIterationCountToGround: number
  minSecondaryStepSize: number
  secondaryStepScale: number

  // ── 云 god rays（M5，SHADOW_LENGTH——marchShadowLength 沿视线累加 BSM 光深；three qualityPresets.ts
  //    defaults.clouds 逐字）──
  /** shadowLength march 最大步数（three：500）。 */
  maxShadowLengthIterationCount: number
  /** shadowLength march 最小步长（米，three：50）。 */
  minShadowLengthStepSize: number
  /** shadowLength march 最大距离（米，three：2e5——主 march maxRayDistance 同域）。 */
  maxShadowLengthRayDistance: number

  // ── scatter 视觉（CloudsMaterial.ts 默认）──
  skyLightScale: number
  groundBounceScale: number
  powderScale: number
  powderExponent: number
  /** 夜间环境底光（方向 B，2026-08-29）：夜间云照明地板——LUT 归零后 skyIrradiance 抬此值，
   *  太阳当地仰角 -5°→-12° 淡入。默认 0.03（2026-09-02 过亮重标——原 0.12 标定漏算
   *  ACES+gamma 暗部放大，见 clouds.frag 注释）。
   *  0 = 关闭（回退纯黑夜间云）。不进质量档位（视觉参数，与 march 档无关）。 */
  nightAmbient: number
  /** 夜间云色调乘子（线性 RGB，乘底光+月光两项；2026-09-01 云偏蓝二轮反馈 uniform 化）。
   *  沿革：冷蓝 (0.72,1,1.32)（2026-08-31 泛红修复对冲远景 transmittance 红化）→(0.72,1,1.15)
   *  →(0.88,1,1.0)（三档拍板 C 档）。demo ?cloudsTint=r,g,b。 */
  nightTint: Cartesian3
  /** 暮光天光补偿倍率（2026-09-01 黄昏云过黑拍板 A 案）：太阳 [+2°,-1.5°] 窗内
   *  skyLightScale 有效倍数 1→boost（补 crude 天光 + overlay 不乘动态曝光的欠亮 ~3×）。
   *  白天（>+2°）精确 1 零回归；<-6° LUT 天光归零后自然无效（nightAmbient 接管）。
   *  demo ?cloudsTwilightBoost=（1=关）。不进质量档位（视觉参数）。 */
  twilightSkyBoost: number
  /** 月光倍率（方向 C，2026-08-30）：moonIrradiance = solar_irradiance×2.5e-6×月相×此值×
   *  nightFactor。默认 25000（2026-08-31 用户反馈夜间云偏亮，三档实测拍板减半：中景云 −36%/
   *  地平亮云 −31%，月光仍主导夜间照明；沿革 50000→25000。物理 2.5e-6 不可见）。
   *  0 = 关（回退 nightAmbient 底光）。视觉参数不进质量档位。URL ?moonLightScale=。 */
  moonLightScale: number

  // ── weather/shape（uniforms.ts + CloudsEffect 默认）──
  coverage: number
  /** 气候带强度（T6，spec §5.4/§6.1）：u_climateBands——0=关（纯随机分布）、1=默认全带。 */
  climateBands: number
  localWeatherRepeat: Cartesian2
  localWeatherOffset: Cartesian2
  shapeRepeat: Cartesian3
  shapeOffset: Cartesian3
  shapeDetailRepeat: Cartesian3
  shapeDetailOffset: Cartesian3
  turbulenceRepeat: Cartesian2
  turbulenceDisplacement: number

  // ── 云层 packed（CloudLayers.DEFAULT 经 packValues/packSums/packIntervalHeights 展开）──
  /** minLayerHeights = packValues('altitude') = (l0.altitude, l1.altitude, l2.altitude, l3.altitude)。 */
  minLayerHeights: Cartesian4
  /** maxLayerHeights = packSums('altitude','height') = (l0.alt+l0.h, l1.alt+l1.h, ...)。 */
  maxLayerHeights: Cartesian4
  /** minIntervalHeights = packIntervalHeights 第 0/1/2 段 min（见 uniforms.ts:141）。 */
  minIntervalHeights: Cartesian3
  /** maxIntervalHeights = packIntervalHeights 第 0/1/2 段 max。 */
  maxIntervalHeights: Cartesian3
  densityScales: Cartesian4
  shapeAmounts: Cartesian4
  shapeDetailAmounts: Cartesian4
  weatherExponents: Cartesian4
  shapeAlteringBiases: Cartesian4
  coverageFilterWidths: Cartesian4
  minHeight: number
  maxHeight: number
  shadowTopHeight: number
  shadowBottomHeight: number
  shadowLayerMask: Cartesian4

  // ── BSM（M3，T4 接通；未就绪时 dummy）──
  /** cascade 数（= shader #define SHADOW_CASCADE_COUNT = CascadedShadowMaps cascadeCount）。 */
  shadowCascadeCount: number
  /** shadowTexelSize：M2 dummy (1,1)；M3 BSM 接通后 = 1/mapSize。 */
  shadowTexelSize: Cartesian2
  /** shadowIntervals[3]：M2 dummy 全 0；M3 由 state.shadow（cascades[i].interval）覆盖。 */
  shadowIntervals: Cartesian2[]
  /** shadowMatrices[3]：M2 dummy identity；M3 由 state.shadow（cascades[i].matrix）覆盖。 */
  shadowMatrices: Matrix4[]
  shadowFar: number
  maxShadowFilterRadius: number

  // ── BSM shadow march 档（M3，qualityPresets.ts defaults.shadow）──
  /**
   * BSM 生成端（ShadowPass，T5 绑定）march 参数。主 march uniformMap 不绑这些——
   * clouds.frag 主 shader 无同名 uniform（绑了反而未声明 uniform）。
   */
  shadowMarch: CloudsShadowMarchParameters

  // ── reprojection（M4 接通：createCloudsStage preRender 每帧写入 jittered 上帧矩阵）──
  /** reprojectionMatrix：(prevP+jitter)*prevV（hitClouds 分支 velocity 用，world/ECEF 路径）。 */
  reprojectionMatrix: Matrix4
  /** viewReprojectionMatrix：reprojectionMatrix*invCurV（scene/ground 分支 velocity 用，view 路径）。 */
  viewReprojectionMatrix: Matrix4
  /** temporalJitter：Bayer 4×4 偏移（低分 UV 单位，preRender 每帧写；非 temporal 恒 (0,0)）。 */
  temporalJitter: Cartesian2

  // ── M4 云 resolve 参数（three CloudsResolveMaterial 默认；demo 验收调参用）──
  /** variance clipping γ（默认 2——upscale 场景大 γ 效果好，拖影换边缘，three 注释同款）。 */
  temporalVarianceGamma: number
  /** temporal 混合 α（默认 0.1；upscale 分支不消费，TAA 分支用——编译对齐）。 */
  temporalAlpha: number
  /**
   * disocclusion rejection 阈值（默认 0.5，2026-09-02 云地平线黑块修复）：resolve 采样
   * history 后 |current.a − history.a| 超此值 = 遮挡关系翻转（云/非云跨界错采），拒绝
   * history 直出 current。>1 恒不触发（禁用）。黑块毒源 |Δa|=1（0↔1）稳触发；云边缘
   * 相位噪声 |Δa|<0.3 不误杀。
   */
  temporalDisocclusion: number
  /**
   * 运动中 α 上限（默认 0.4，2026-09-02 运动自适应混合比）：相机运动标量超阈值时
   * resolve 的 temporalAlpha 从 temporalAlpha（静止收敛值）平滑升至本值——history
   * 拖影/重投影错位权重下降（抖动换细颗粒）。= temporalAlpha 时等效禁用。
   */
  motionAlpha: number
}

/**
 * CloudLayers packed uniform 默认值（结构对齐 three-geospatial CloudLayers.ts:31-68）。
 *
 * 4 层（2026-09-04 高度重定后，live 值以 cloudLayersPacking.ts DEFAULT_CLOUD_LAYERS 为单一来源，
 * 下方返回体经 packLayerUniforms 派生——本注释仅记结构语义）：
 *   L0 r  altitude=1500 height=650   densityScale=0.2   shapeAmount=1    shapeDetail=1  weatherExp=1  shapeAlter=0.35  coverageFW=0.6  shadow=true
 *   L1 g  altitude=2000 height=1200  densityScale=0.2   shapeAmount=1    shapeDetail=1  weatherExp=1  shapeAlter=0.35  coverageFW=0.6  shadow=true
 *   L2 b  altitude=7500 height=500   densityScale=0.003 shapeAmount=0.4  shapeDetail=0  weatherExp=1  shapeAlter=0.35  coverageFW=0.5  shadow=false
 *   L3 a  altitude=0    height=0     (default CloudLayer)
 *
 * packIntervalHeights 算法（uniforms.ts:141-180）：entries 排序后 balance=0 处切区间。
 *   entries: (0,open)(1500,open)(2000,open)(2150,close)(3200,close)(7500,open)(8000,close)
 *   区间: [0,1500] [3200,7500] [0,0]
 *   → minIntervalHeights=(0, 3200, 0), maxIntervalHeights=(1500, 7500, 0)
 */
export function defaultCloudsParameters(): CloudsParameters {
  return {
    // 相机/场景
    frame: 0,
    targetUvScale: new Cartesian2(1.0, 1.0),
    mipLevelScale: 1.0,

    // 大气（bottomRadius = ATMOSPHERE.bottomRadius = 6360000 米——clouds.frag 坐标全程米：
    // L369 height = length(position) - bottomRadius、L736 bottomRadius + minHeight 均 meter 单位。
    // 注意：这与 Bruneton GLSL const ATMOSPHERE.bottom_radius=6360（km，经 METER_TO_LENGTH_UNIT）
    // 不同——clouds 的 bottomRadius uniform 是 three-atmosphere TS 侧原始米值）
    bottomRadius: 6360000,
    worldToECEFMatrix: Matrix4.IDENTITY,
    ecefToWorldMatrix: Matrix4.IDENTITY,

    // 参与 medium（uniforms.ts:50-51）
    scatteringCoefficient: 1.0,
    absorptionCoefficient: 0.0,

    // 主 raymarch（qualityPresets defaults = high）
    maxIterationCount: 500,
    minStepSize: 50,
    maxStepSize: 1000,
    maxRayDistance: 2e5,
    perspectiveStepScale: 1.01,
    minDensity: 1e-5,
    minExtinction: 1e-5,
    minTransmittance: 1e-2,

    // 次 raymarch（qualityPresets defaults）
    maxIterationCountToSun: 2,
    maxIterationCountToGround: 3,
    minSecondaryStepSize: 100,
    secondaryStepScale: 2,

    // 云 god rays（M5，three defaults.clouds 逐字）
    // 【2026-09-04 god rays march 改造（专家组 A2）】甲内近水平场景 shadowLength march 与
    // 主 march 平行同量级打满（500 步上限/无封顶，此前所有归因遗漏的第二 march）：段长
    // 2e5→16000（god rays 视觉有效域=近中云，attenuation(1-5e-4)^146≈0.93 慢衰减但
    // 远端光柱贡献被大气散射主导）+ 步数 500→150（50×1.01^n 走满 16km 需 146 步，自洽）
    // + shader 侧步长封顶 min(stepSize, maxStepSize)。god rays 场景验收后定稿。
    maxShadowLengthIterationCount: 150,
    minShadowLengthStepSize: 50,
    maxShadowLengthRayDistance: 16000,

    // scatter 视觉（CloudsMaterial.ts:212-215）
    skyLightScale: 1.0,
    groundBounceScale: 1.0,
    powderScale: 0.8,
    powderExponent: 150.0,
    // 夜间环境底光（方向 B；本仓库新增，非 three 移植——上游无夜间光源是已知缺失）。
    // 0.12→0.03（2026-09-02 夜间云过亮重标）：原 0.12 标定漏算 ACES+gamma 暗部放大
    // （线性×255≈18/255 误当 display，实际 ~86/255，且月光落地后叠加从未整体验收——
    // 深夜云带 avg 147 vs 夜空底光实测 ~5）。headed 扫描定标 0.03：无月夜云带 61/>120 清零。
    nightAmbient: 0.03,
    // 暮光天光补偿（2026-09-01 黄昏云过黑 A 案）：6=用户拍板物理档（实测云/天空显示比 80%，
    // 接近物理目标 85-90%；档位沿革 3 温和=51%/6 物理=80%，?cloudsTwilightBoost= URL 即调）
    twilightSkyBoost: 6.0,
    // 夜间云色调乘子（线性域，乘底光+月光两项；2026-09-01 uniform 化+三档拍板定稿 C 档——
    // 沿革 (0.72,1,1.32) 泛红对冲→(0.72,1,1.15) 一轮弱蓝→(0.88,1,1.0) 二轮弱蓝拍板：
    // 蓝收干净+红大幅回抬，实测云 B/G=1.06（残余蓝=云介质散射谱依赖的物理蓝移）、
    // R/G=0.84 中性偏暖灰白；demo ?cloudsTint=）
    nightTint: new Cartesian3(0.88, 1.0, 1.0),
    // 月光倍率（方向 C，2026-08-30；同 interface 注释——0 = 关，回退 nightAmbient 底光）
    moonLightScale: 25000, // 2026-08-31 偏亮反馈三档拍板减半（50000→25000，中景云 −36%）

    // weather/shape（uniforms.ts:54 + CloudsEffect.ts:180-186）
    coverage: 0.3,
    // 气候带强度（T6，spec §5.4）：1=默认全带（ITCZ 峰/副热带谷/风暴带/极地衰减）；0=关
    climateBands: 1.0,
    // 经纬域 repeat（face 缝根治 2026-09-03 方案 A）：x=经向瓦数（赤道瓦宽 40075/400
    // ≈100km）、y=纬向瓦数（20015/200 ≈100km，保瓦物理方形）——与旧 face 域 (100,100)
    // 的瓦物理尺寸连续（face 域 100 瓦/face ≈ 经纬域 400 瓦/赤道）。x 须偶数：经度割缝
    // lon=±π 两侧 x 差 repeat/2，偶数×0.5=整数瓦 = REPEAT wrap 两侧同点闭合。
    localWeatherRepeat: new Cartesian2(400.0, 200.0),
    localWeatherOffset: new Cartesian2(0.0, 0.0),
    shapeRepeat: new Cartesian3(0.0003, 0.0003, 0.0003),
    shapeOffset: new Cartesian3(0.0, 0.0, 0.0),
    shapeDetailRepeat: new Cartesian3(0.006, 0.006, 0.006),
    shapeDetailOffset: new Cartesian3(0.0, 0.0, 0.0),
    turbulenceRepeat: new Cartesian2(20.0, 20.0),
    turbulenceDisplacement: 350.0,

    // 云层 packed：从 DEFAULT_CLOUD_LAYERS 单一来源派生（2026-09-04 前系逐字段手抄副本，
    // 层缺省调整时会静默脱钩——此后改层缺省只动 cloudLayersPacking.ts 一处）
    ...packLayerUniforms(DEFAULT_CLOUD_LAYERS),

    // BSM（M3，T4 接通；state.shadow 未就绪时 fallback 这些 dummy 值）
    shadowCascadeCount: 3, // = shader #define SHADOW_CASCADE_COUNT 3 = CascadedShadowMaps cascadeCount
    shadowTexelSize: new Cartesian2(1.0, 1.0),
    shadowIntervals: [
      new Cartesian2(0, 0),
      new Cartesian2(0, 0),
      new Cartesian2(0, 0)
    ],
    shadowMatrices: [
      Matrix4.IDENTITY,
      Matrix4.IDENTITY,
      Matrix4.IDENTITY
    ],
    shadowFar: 0,
    maxShadowFilterRadius: 6,

    // BSM shadow march 档（qualityPresets.ts defaults.shadow 逐字；ShadowPass 侧 T5 绑定）
    shadowMarch: {
      maxIterationCount: 50,
      minStepSize: 100,
      maxStepSize: 1000,
      minDensity: 1e-5,
      minExtinction: 1e-5,
      minTransmittance: 1e-4,
      opticalDepthTailScale: 2
    },

    // reprojection（M4：preRender 每帧经 temporalMath 覆写；此处默认值仅首帧前 fallback）。
    // ⚠️ 勿用 Matrix4.IDENTITY 直接引用——那是 Object.freeze 的全局常量，preRender 的
    // Matrix4.clone(result, …) 覆写会抛 TypeError（ESM 严格模式写冻结对象；同 M3 的
    // shadowMatrices 坑）。new Matrix4() 构造即 identity 且可变。
    reprojectionMatrix: new Matrix4(),
    viewReprojectionMatrix: new Matrix4(),
    temporalJitter: new Cartesian2(0.0, 0.0),

    // M4 云 resolve（three CloudsResolveMaterial 默认；temporalDisocclusion 为本项目
    // 2026-09-02 黑块修复新增，three 无此项）
    temporalVarianceGamma: 2.0,
    temporalAlpha: 0.1,
    temporalDisocclusion: 0.5,
    motionAlpha: 0.4
  }
}
