// createCloudsStage.ts
//
// M2 T3：顶层工厂——编排 CloudsPass + cloudsBuffer bridge → 接 createAtmosphereStage PostProcess 链
// （cloudsBuffer overlay 在 atmosphere 之后，spec §4.3）。czm 桥接（spec §4.2）：
//   - sunDirection：Simon1994 + ICRF→Fixed → ECEF（preRender 每帧更新，仿 AtmosphereStage）
//   - moonDirection/moonIlluminatedFraction：月光照明（方向 C，spec r2 §6.5）——Simon1994 月位置
//     复用太阳段 icrfToFixed + 视差修正 origin=camera+altitudeCorrection；月相因子由 state
//     两方向 dot 算（computeMoonIlluminatedFractionFromDirections，同帧同源）
//   - altitudeCorrection：getAltitudeCorrectionOffset（密切球再中心化，R2 防大坐标单精度失效）
//   - reprojectionMatrix/viewReprojectionMatrix/temporalJitter：M2 dummy identity/0（M4 temporal 接通）
//
// M3 T5 BSM 编排（本文件新增，plan 决策 D2/D5/D6）：
//   - preRender（sunDirection 更新后）：太阳天顶角 → 虚拟光源距离 lerp(1e6, 1e3, zenith)
//     （three CloudsEffect.ts:387 语义）→ CascadedShadowMaps.update（near/far = 完整视锥
//     preRender 时刻值；far 与 maxRayDistance 取小，D6）→ shadowState.matrices/intervals/
//     cameraNear/far 覆写 → ShadowPass.render()（先于云 march VOXELS pass，此刻 GL 状态干净）
//   - ShadowPass uniformMap = buildSharedCloudsUniforms（与主 march 同源共享段，CloudsPass.ts
//     抽出）+ BSM 专属（inverseShadowMatrices 数组闭包 + shadowMarch 档 7 参数平铺）
//   - options.shadowPass=false（demo ?cloudsShadow=0）→ 诊断基线：不建 cascades/ShadowPass，
//     state.shadow 恒 undefined → 主 march fallback dummy → Beer=1（无自阴影，M2 行为）
//
// BSM world 锚定编排（T4，spec v3 §3.1——缺省 world，?cloudsShadowAnchor=frustum 回退）：
//   - cascades 构造按 shadowAnchor 分支（world 用类内缺省设计值 radii/intervals）
//   - preRender BSM 段：world 分支太阳量化喂矩阵（march/消费端精确，§3.1.8）、far 单源
//     cascades.far=worldIntervals[cascadeCount]（T4 不变式，不随视锥）、cameraNear=0
//     （§3.1.5）、distance 不传（z 盒解析）；frustum 分支 bit 级保留现行为（AB 基线）
//
// 静止跳过（T5，spec §3.2）：cascades.update 返回矩阵是否变化（world 语义键），静止帧
// 跳过整段矩阵覆写 + shadowPass.render（重 march 必产出相同内容——白赚）；与 shadowFreeze
// 诊断正交（freeze=update 不跑、render 照常每帧——冻结网格重 march 是其噪声分解语义）。
//
// M4 temporal 编排（plan D1/D2/D7）：
//   - 云端（options.temporal≠false，demo ?cloudsTemporal=0 关）：march 1/4 分（CloudsPass
//     temporalUpscale）→ CloudsResolvePass（第二个 VOXELS primitive，add 在 march 之后——
//     同 pass 内 PrimitiveCollection 数组序即执行序）Bayer 4×4 全分重建 + velocity
//     reprojection + variance clipping；overlay 的 u_cloudsBuffer 切读 resolve 输出
//   - preRender 顺序：resolvePass.swapBuffers() 最前（等价 three render 后 swap）→
//     params.frame++（march/BSM 生成端 frame uniform 已按各端 temporal 开关拆分绑定，
//     单端关时不闪烁）→ Bayer jitter + reprojection 矩阵（temporalMath，ECEF 域 +
//     preRender 完整视锥矩阵）→ BSM setCurrentMatrices（render 内部 prev=上帧、末尾存本帧）
//   - BSM 端（options.shadowTemporal≠false）：ShadowPass temporalPass（velocity 层 +
//     shadowResolve ping-pong，T5）；state.shadow.bsm = resolve 后 history（getter 自动）
//
// 集成（spec §4.3 + 附录 F4）：
//   - CloudsPass 是 Primitive（非 PostProcessStage）→ cloudsBuffer（att0）必须用 bridge {_texture,_target}
//     注入 overlay PostProcessStage uniform（不能用 uniform-name string，F4）
//   - v2 spec §6.2/§6.3：overlay 是 per-handle 资源（跨 setQuality 存活）、创建后不自动 add——
//     add 时机移交消费者（demo 走 core 侧 insertStageBeforeLensFlare 插到 atmosphere 之后、
//     lensFlare/tonemap 之前，halo 光晕叠加在云之上；独立消费者自行 add 到链尾）
//   - overlay 读前一 stage 输出（atmosphere 线性 HDR）+ cloudsBuffer（linear HDR premultiplied），
//     线性域 over 合成（v2 spec §4.1），ACES+gamma 由链尾 tonemap 统一收尾
//
// 零回归：clouds:false（或不传）→ 不创建 primitive/stage，返回 undefined（demo 可无条件调用）。
//
// T4 质量档位（spec 2026-08-29 §6/§7）：装配体提取为 buildCloudsStageImpl——
//   - quality 三路接线：编译开关（applied.main → createCloudsPass options + ShadowPass
//     shaderOptions）/ uniform（applied.params）/ BSM 结构（applied.shadow 的
//     cascadeCount/mapSize，去 hardcode；shadowMatrices/intervals/inverse 数组按
//     cascadeCount 生成）
//   - far 不变式（spec §6 v2）：world 分支 shadowState.far ≡ cascades.far
//     （= worldIntervals[cascadeCount]，updateWorld 内部单源）——废除 SHADOW_FAR_LIMIT
//     独立参与，防生成端/消费端归一化域分叉；frustum 分支 bit 级现行为不变
//   - 零直捕 listener（spec §7）：preRender listener 顶层挂一次、体内零直捕局部量、
//     一切经 impl——任何直捕会静默驱动已销毁 impl（frame 计数分叉、矩阵停更）
//   - setQuality（spec §7）：统一内部重建（销毁旧 impl → 重 resolve → 重建资源 →
//     换引用），句柄稳定（公开字段 getter 委托 impl）；per-impl 可复位状态
//     （matricesFrozen/prevCamera）随重建自然归零
//
// T6 云分布集成（spec 2026-09-03 §4/§5.4/§6）：
//   - buildImpl 创建 WeatherAtlas（烘焙 / pngFallback / atlasDisabled escape）注入
//     state.atlasTexture；preRender 时间轴（T1 纯函数 CPU float64 mod）覆写 atlasT/
//     windOffset/itczCenterSin——evolutionPhaseS 调试钩子仅偏移演化/平流不动太阳
//   - altitudeOffsetM 经 T2 派生链重算 15 项层 packed uniforms（红队 BLOCKER-4 闭环）
//   - setWeatherPreset 天气预设热切（coverage/filterScale 基线缩放 + climateBandsFloor
//     0.6 组合语义，spec §5.4）——handle 侧记 activePreset，setQuality 重建后重放

import {
  PostProcessStage,
  PostProcessStageSampleMode,
  Cartesian2,
  Cartesian3,
  Cartesian4,
  Matrix4,
  Matrix3,
  Simon1994PlanetaryPositions,
  Transforms,
  JulianDate,
  PixelFormat,
  PixelDatatype,
  Texture,
  Texture3D,
  type Scene,
  type Context
} from 'cesium'
import {
  getAltitudeCorrectionOffset,
  ATMOSPHERE_BOTTOM_RADIUS_M,
  computeMoonDirectionECEF,
  computeMoonIlluminatedFractionFromDirections,
  type AtmosphereLUTs
} from '../cesium-core'
import {
  createCloudsPass,
  buildSharedCloudsUniforms,
  resolveCloudsHdrDatatype,
  type CloudsPass,
  type CloudsFrameState,
  type CloudsPassOptions
} from './CloudsPass'
import { createCloudsResolvePass, type CloudsResolvePass } from './CloudsResolvePass'
import {
  computeTemporalJitter,
  buildReprojectionMatrices,
  computeMotionAlpha,
  MOTION_EQUIV_RADIUS_M,
  type TemporalCameraSnapshot
} from './temporalMath'
import { CascadedShadowMaps } from './CascadedShadowMaps'
import { createShadowPass, type ShadowPass } from './ShadowPass'
import { quantizeSunDirection, SUN_QUANT_STEP } from './sunQuantization'
import {
  CLIMATE_BANDS_FLOOR_DEFAULT,
  CLIMATE_BANDS_FLOOR_PRESET,
  type CloudsParameters,
  type CloudsShadowFrameState
} from './cloudsDefaultParameters'
import { applyQualityPreset, type AppliedCloudsQuality, type CloudsQualityPreset } from './qualityPresets'
import type { WeatherTextures } from './weatherTextures'
// 云分布重设计（spec docs/superpowers/specs/2026-09-03-clouds-distribution-redesign-design.md）：
// T1 时间轴纯函数 / T2 层参数 packed 派生 / T5 WeatherAtlas 烘焙——本文件为运行时集成点（T6）。
import {
  computeDayOfYear,
  computeEvolutionTNorm,
  computeItczCenterLatDeg,
  computeShapeWindOffsets,
  computeWindOffsetTiles
} from './weatherTime'
import { applyAltitudeOffset, packLayerUniforms, DEFAULT_CLOUD_LAYERS } from './cloudLayersPacking'
import { createWeatherAtlas, resolveWeatherAtlasPlan, type WeatherAtlas } from './WeatherAtlas'

// 云图时间轴历元（spec §4.1）：tSec = scene.time 相对此历元的秒差——CPU float64 mod 后才传
// uniform（JulianDate 绝对秒 ~8.4e8 超出 float32 精度，GPU 侧禁止对原始秒 mod）。
const WEATHER_EPOCH = JulianDate.fromIso8601('2000-01-01T12:00:00Z')

/** 天气预设档（T6，spec §6.1：晴/少云/多云/阴天一键组合；undefined=清除预设回创建基线）。 */
export type CloudsWeatherPreset = 'clear' | 'fair' | 'cloudy' | 'overcast'

/**
 * 预设 → 采样端调制表（spec §6.1 预设初值，验收时拍板微调）：
 * coverage 直接写 params.coverage；filterScale 缩放基线 coverageFilterWidths（overcast 0.6
 * 收窄 → remap 过渡更陡 → 连片）。激活时另写 state.climateBandsFloor=0.6（spec §5.4 组合
 * 语义：预设 × 副热带谷不退化为近晴空），清除恢复缺省 0.2。
 */
export const WEATHER_PRESETS: Record<CloudsWeatherPreset, { coverage: number; filterScale: number }> = {
  clear: { coverage: 0.08, filterScale: 1.0 },
  fair: { coverage: 0.2, filterScale: 1.0 },
  cloudy: { coverage: 0.45, filterScale: 1.0 },
  overcast: { coverage: 0.65, filterScale: 0.6 }
}

/** 烘焙输入（T6 options.weatherBake；仅这些变化才需重烘——采样时调制走 uniform 热切，spec §4.3）。 */
export interface CloudsWeatherBakeOptions {
  /** 演化周期（小时）；缺省 5.3（64 切片 × 5min）。demo ?cloudsEvolutionHours=。 */
  evolutionHours?: number
  /** 平流风速 m/s；缺省 8。demo ?cloudsWind=. */
  windMps?: number
  /** 烘焙种子；缺省 1337。demo ?cloudsSeed=. */
  seed?: number
  /** cube face 上 weather 平铺次数；缺省 100。 */
  weatherRepeat?: number
}

/**
 * createCloudsStage 选项（透传 CloudsPassOptions + clouds 开关）。
 * v3（spec §5）：parameters 入口类型 Partial（合并语义见 applyQualityPreset）——用 Omit 重组，
 * CloudsPassOptions.parameters 保持全量契约（createCloudsPass 整体替换语义不动，CloudsPass 零改动）。
 */
export interface CloudsStageOptions extends Omit<CloudsPassOptions, 'parameters'> {
  /** 业务参数覆盖（字段级浅合并：缺省→档位→此处显式；shadowMarch 整对象；Cesium 数学类型内部 clone）。 */
  parameters?: Partial<CloudsParameters>
  /** 质量档位（缺省 'high' = 现状零回归；spec §3 四档逐字对齐参考库）。demo ?cloudsQuality=low。 */
  quality?: CloudsQualityPreset
  /**
   * clouds 开关（默认 false → 不创建 stage，零回归）。
   * demo 在 atmosphere mode 内 `?clouds=1` 时传 true。
   */
  clouds?: boolean
  /**
   * overlay 云曝光（默认 12，线性域云 premultiplied 值缩放）。
   * demo `?cloudsExposure=N` 调节。
   */
  cloudsOverlayExposure?: number
  /**
   * 【2026-09-03 穿云黑块探针】overlay 数值直显：0=正常合成（缺省）；1=直显 cloudsBuffer.a；
   * 2=直显 cloudsBuffer.rgb 线性原值。诊断 resolve 输出真实 rgba 用。demo `?cloudsOverlayDebug=N`。
   */
  overlayDebug?: number
  /**
   * 高空云层渐隐开关（**默认 true**，2026-09-03 用户拍板方向）：相机地心高度超过
   * heightFadeStart 后云 overlay 渐隐、heightFadeEnd 全隐——太空俯视（demo 默认开场
   * 16136km）下 march 采样域外伪影不可根治且视觉贡献趋零，隐去后为干净蓝色地球。
   * demo `?cloudsFade=0` 关闭（逃生门，看全量云盘）。
   */
  heightFade?: boolean
  /** 渐隐起始高度（米，缺省 5e4=50km）：以下全显。 */
  heightFadeStart?: number
  /** 渐隐终止高度（米，缺省 3e5=300km）：以上全隐。 */
  heightFadeEnd?: number
  /**
   * M3 BSM 自阴影生成开关（默认 true）。false = 诊断基线：不创建 CascadedShadowMaps/
   * ShadowPass，state.shadow 恒 undefined → 主 march fallback 全 0 dummy → Beer=1
   * （无自阴影，M2 flat 行为；对比云体积感用）。demo `?cloudsShadow=0`。
   */
  shadowPass?: boolean
  /**
   * M4 云 temporal resolve 开关（**默认 true**，2026-09-02 拍板对齐源库 three——其
   * CloudsMaterial.temporalUpscale 默认 true）。1/4 分 march + CloudsResolvePass（Bayer
   * 重建 + velocity reprojection + variance clipping + temporalAlpha 混合）——帧率优势
   * 明显（120fps vs 全分卡死）。
   *
   * 历史：2026-08-17 曾默认 false——当时静止云持续高频抖动（连拍 12-16%）。2026-09-02
   * 根因排查（readPixels 实证 march velocity 正确=−jitter；抖动源=Bayer 16 相位超采样
   * 轮换本身，高对比云区被显示层放大；EMA 对 16 帧周期输入稳态无衰减）后两项修复：
   * ① 静止冻结——相机静止（positionWC 距上帧 <0.01m）时 frame 不递增，jitter/STBN
   *   相位恒定 → march 恒 → resolve 逐位稳（实测 30s 瓦片收敛后 npx>5=0）；
   * ② resolve 输出 mix(clipped(history), current, temporalAlpha)——运动中轮换分量
   *   EMA 平滑（对低频 16 相位不完全有效但降低可见度，TAA 标准做法）。
   * false = M2/M3 稳定行为（全分 march、无 resolve、overlay 直读 march att0）；
   * demo `?cloudsTemporal=0` 逃生门。
   */
  temporal?: boolean
  /**
   * M4 BSM temporal resolve 开关（**默认 false**，同上——抖动排查期间保守默认；BSM 端
   * 机制已验证可用，生成端 jitter + 0.01 慢收敛）。demo `?cloudsShadowTemporal=1` 开。
   */
  shadowTemporal?: boolean
  /**
   * 诊断：冻结 cascade 矩阵（首帧 update 后不再更新，BSM 在冻结网格上每帧重 march）。
   * 噪声分解实验用——「冻结矩阵 + 相机移动」录屏差分 = 非矩阵噪声地板（层切换/jitter/
   * 消费端通道），与不冻结对照相减得矩阵通道分量。demo `?cloudsShadowFreeze=1`。
   * 与 T5 静止跳过正交：freeze 下 update 不跑但 render 照常每帧（重 march 正是实验内容）。
   */
  shadowFreeze?: boolean
  /**
   * BSM 矩阵锚定模式（spec v3）：'world'（缺省）= 世界锚定固定网格（interval 常数
   * {0,10,21,60}km、相机 light 投影 snap 固定 texel 网格、太阳量化喂矩阵、far/cameraNear
   * 固定不随视锥——消相机移动/缩放时级联矩阵逐帧重排的闪动）；'frustum' = 现实现视锥
   * 拟合（AB 对照基线，bit 级保留含已知缺陷——distance 入壳、视锥 far 参与等）。
   * demo `?cloudsShadowAnchor=frustum`。
   */
  shadowAnchor?: 'world' | 'frustum'
  /**
   * world 锚定模式每层 ortho 半径覆盖（m，长度 = cascadeCount；仅 shadowAnchor='world'
   * 时生效）。缺省不传 = CascadedShadowMaps 类内 WORLD_RADII_DEFAULT（设计值单源）。
   * demo `?cloudsShadowScale=N` → WORLD_RADII_DEFAULT.map(r => r*N)（E1' 归因实验：
   * radii×5={80,168,480}km 膨胀层覆盖全程航迹）。
   */
  worldRadii?: number[]
  /**
   * temporal upscale 降采样分母（涂抹修复 T1，2026-09-02）：2 = march 半分（RT 面积 ×4，
   * 细节上限 4px→2px 像素周期，涂抹感约减半；帧率代价需实测）。缺省随档位（仅 ultra=2），
   * 无档位时 4（three 原文行为零回归）。用户显式 > 档位（spec §5 合并规则）。
   * 1 = march 全分 + resolve 走 TAA 分支（temporalAntialiasing）= 全分辨率 + 时域降噪
   * （2026-09-02 用户追加档；march 成本最高，画质最佳）。
   * demo `?cloudsUpscale=1|2|4`。
   */
  upscaleDivisor?: 1 | 2 | 4
  /**
   * T6 云高度偏移（米，spec §6.1）：低云带 L0/L1 altitude += clamp(offset, -500, 3000)，
   * 经 T2 派生链（applyAltitudeOffset → packLayerUniforms）重算全部 15 项层 packed uniforms
   * （红队 BLOCKER-4 教训：minLayerHeights/minHeight/shadowTop/Bottom/intervalHeights 必须
   * 同链重算）。**仅显式传时派生**——不传保持 defaults 写死值零回归（也防 clobber 用户
   * 显式层参数）。demo `?cloudsAltitudeOffset=`。
   */
  altitudeOffsetM?: number
  /**
   * 【2026-09-04 甲内近水平 march LOD】云内步 mip 调制倍率（clouds.frag u_hitStepMipBoost）：
   * 命中云后的步长 `mix(stepSize, maxStepSize, min(1, mipLevel·boost))`。缺省 1=空区步同款
   * 调制；甲内近水平「沿云飞」场景（2519m+pitch≈-9.5°，sampleCount 实测 300-500 步/像素
   * 打满 28 FPS）调大可大幅削减远云步数。demo `?cloudsHitMipBoost=`。
   */
  hitStepMipBoost?: number
  /**
   * 【2026-09-04 march 实验参数直通】单变量 perf 分解用（仅显式传时覆盖档位值）：
   * 主 march 迭代上限 / 透射率早退阈值 / 受照次级 march 预算 / 最大步长。
   * demo `?cloudsMaxIter=` / `?cloudsMinTrans=` / `?cloudsToSunIter=` / `?cloudsMaxStep=`。
   */
  maxIterationCount?: number
  minTransmittance?: number
  maxIterationCountToSun?: number
  maxStepSize?: number
  /**
   * T6 WeatherAtlas 烘焙输入（spec §4.3）：仅这些变化才需重烘；采样时调制（coverage/密度/
   * 气候带/预设）走 uniform 热切不动烘焙。缺省走 WeatherAtlas 内置缺省（5.3h/8m/s/1337/100）。
   */
  weatherBake?: CloudsWeatherBakeOptions
  /**
   * T6 escape 开关（spec §6.1 `?cloudsAtlas=0`）：跳过烘焙、把旧静态 local_weather.png
   * （weather.localWeatherRaw）包装成 64 层 3D atlas（WeatherAtlas pngFallback 路径，对照/
   * 逃生两用）。raw 缺失（PNG decode 失败）时退化为 warn + 1×1×1 全白 dummy（连续云墙降级）。
   */
  atlasDisabled?: boolean
  /**
   * T6 调试钩子（spec §4.1 演化验收解耦）：秒级偏移演化相位与平流输入
   * （atlasT = f(tSec + phase)、windOffset = g(tSec + phase)），不动太阳/天光——验收时
   * 快进到指定演化相位。demo `?cloudsEvolutionPhase=`。
   */
  evolutionPhaseS?: number
  /**
   * T6 创建期天气预设（spec §6.1）：创建后立即应用（等价创建后即刻 setWeatherPreset）；
   * 运行期热切走 handle.setWeatherPreset。demo `?cloudsWeather=`。
   */
  weatherPreset?: CloudsWeatherPreset
}

/** createCloudsStage 句柄：持 CloudsPass + overlay stage + destroy + setQuality。
 *  （T4 起公开字段为 getter 委托内部 impl 引用——对外形状/只读语义不变，spec §7。） */
export interface CloudsStageHandle {
  /** CloudsPass（primitive + MRT + uniformMap）。 */
  readonly cloudsPass: CloudsPass
  /** cloudsBuffer overlay PostProcessStage（per-handle，跨 setQuality 引用恒定；创建后**未 add**——demo 走 `insertStageBeforeLensFlare` 编排，独立消费者自行 `scene.postProcessStages.add`，见 README）。 */
  readonly overlayStage: PostProcessStage
  /** ShadowPass（BSM 生成端；options.shadowPass=false 时 undefined）。调试/探针采样用。 */
  readonly shadowPass?: ShadowPass
  /** BSM 帧状态（级联矩阵/分段/near/far——preRender 每帧覆写；数值调试只读用）。 */
  readonly shadowState: CloudsShadowFrameState
  /** CascadedShadowMaps 实例（级联 split/frusta/bbox 中间量调试用）。 */
  readonly cascades: CascadedShadowMaps
  /**
   * T9 调试：WeatherAtlas 当前模式（T8 遗留——此前无运行时探针，console 推断不可靠）。
   * 'baked'=GPU 烘焙 3D atlas / 'pngFallback'=escape（?cloudsAtlas=0）或烘焙失败降级的
   * 静态 PNG 包装 / 'dummy'=PNG decode 失败的 1×1×1 全白降级 / undefined=无 atlas 也无
   * dummy 的异常态。跟随当前 impl（setQuality 换档后指向新 atlas）。
   */
  readonly weatherAtlasMode: 'baked' | 'pngFallback' | 'dummy' | undefined
  /**
   * 运行时换质量档位（spec §7 统一内部重建：销毁旧 impl → 以「创建时用户显式 options +
   * 新 quality」重新 resolve（用户显式参数保留，§5 合并规则）→ 重建全部资源 → 换 impl 引用）。
   *
   * - 仅帧间调用（事件回调外）——帧内（preUpdate/preRender 等渲染回调中）调用不安全
   *   （primitives.remove 发生在 commandList 已建后）；demo 键盘回调在帧间，安全。
   * - 同档 no-op（浅比较）；destroy 后 no-op + console.warn（对齐 destroy 幂等的宽容风格）。
   * - 原子性：重建（GL 资源创建等）抛错时旧 impl 已销毁、句柄半死不可自愈 → 置作废
   *   并 rethrow——此时须重建整个 stage。
   * - 换档瞬间有 shader 重编译长帧（跨档必触 #define 裁剪，数百 ms，spec §2 可接受）。
   * - overlay 是 per-handle 资源（v2 §6.2）：换档不重建、不重新 add——链上相对顺序恒定，
   *   uniform 源闭包自动切新 impl 的 bridge。
   * - 与参考库 setter 语义有意不同（spec §5）：参考库 Object.assign 直接覆盖实例
   *   （档位 > 用户微调、微调丢失）；本实现用户显式 > 档位，换档保留微调。
   */
  setQuality(next: CloudsQualityPreset): void
  /**
   * T6 天气预设热切（spec §6.1）：写当前 impl 的 params.coverage / coverageFilterWidths
   * （闭包引用改值即生效，nightAmbient 同款）+ state.climateBandsFloor（spec §5.4 组合语义：
   * 预设激活 0.6，防「阴天」×副热带谷退化为近晴空）。**undefined = 清除预设**：恢复创建时
   * 基线（用户显式 parameters 优先于默认 0.3/(0.6,0.6,0.5,0.6)）+ floor 0.2。
   *
   * - 与参考库 setter 语义同款（spec §5）：直接改值，不重建资源；帧间/帧内均可（纯 CPU 写）。
   * - **跨 setQuality 保持**：激活中的预设记在 handle 侧，换档重建后自动重放到新 impl。
   * - destroy 后 no-op + console.warn（对齐 setQuality 宽容风格）。
   */
  setWeatherPreset(preset: CloudsWeatherPreset | undefined): void
  /** 释放：摘 preRender listener + impl 完整销毁（CloudsPass/resolvePass/ShadowPass/
   *  turbulence dummy）+ 摘顶层 overlay。幂等。 */
  destroy(): void
}

// overlay fragment shader（v2 spec §4.1 线性域化）：读前一 stage 输出（atmosphere 线性 HDR）+
// cloudsBuffer（march/resolve 输出，premultiplied 线性 HDR）。
// 线性域 premultiplied over：cloud.rgb 已含 opacity 因子，直接加和（无 unpremultiply/ACES/gamma——
// 由链尾 tonemap 统一收尾，消灭 M2「云单独 ACES」display 域双 ACES 债）。
// 位置：atmosphere 之后、lensFlare/tonemap 之前（demo 经 insertStageBeforeLensFlare 编排）——
// halo 光晕叠加在云之上（修复「光晕被云覆盖」）。
//
// 无样本路径 clouds.frag color=vec4(0) → a=0 且 rgb=0 → final = x·1.0 + 0·E = x，逐位透传。
// 颜色标定：u_cloudsExposure = 线性域云 premultiplied 值缩放（three 版 storybook ToneMapping
// exposure=10 → 本项目 display 域时代标定 6 → 线性域起点沿用 6，V2 视觉验收后定稿）。
const OVERLAY_SHADER = `uniform sampler2D colorTexture;
uniform sampler2D u_cloudsBuffer;
uniform float u_cloudsExposure;
// 【2026-09-03 穿云黑块探针】0=正常合成；1=直显 cloudsBuffer.a；2=直显 cloudsBuffer.rgb（线性原值）。
uniform float u_overlayDebug;
// 【2026-09-03 高空云层渐隐】相机高度渐隐系数（1=全显 0=全隐；JS 每帧算好传入）。
// 只作用于正常合成路径（debug 直显看原始数据）；premultiplied 域 rgb/a 同乘——
// 0 时 final=scene.rgb 逐位透传。
uniform float u_heightFade;
in vec2 v_textureCoordinates;

void main() {
  vec4 scene = texture(colorTexture, v_textureCoordinates);
  vec4 cloud = texture(u_cloudsBuffer, v_textureCoordinates);
  if (u_overlayDebug > 1.5) {
    out_FragColor = vec4(cloud.rgb, 1.0);
    return;
  }
  if (u_overlayDebug > 0.5) {
    out_FragColor = vec4(vec3(cloud.a), 1.0);
    return;
  }
  // 线性域 premultiplied over（spec D5）：E·premultiplied ≡ premultiplied(E·straight)。
  // ACES + gamma 由链尾 tonemap 统一。u_heightFade 同乘 rgb 与 a（渐隐=整体变透明）。
  vec3 final = scene.rgb * (1.0 - cloud.a * u_heightFade) + cloud.rgb * (u_cloudsExposure * u_heightFade);
  out_FragColor = vec4(final, scene.a);
}
`

// 云 overlay 曝光（v2 spec §4.3/D7）：线性域云 premultiplied 值缩放（链尾统一 ACES）。
// 2026-08-29 V2 视觉验收定稿：用户在 e3/e6/e10/e15 四档目验后拍板 12（黄昏逆光视角云体积感/
// 亮度平衡；注意 E 与 lf thresholdLevel=3.0 强耦合——E 调高亮云会参与 flare 能量提取）。
const CLOUDS_OVERLAY_EXPOSURE_DEFAULT = 12

// ── 高空云层渐隐（2026-09-03）───────────────────────────────────────────────
// 太空俯视（demo 默认开场 16136km）下 march 采样域外的伪影（云形 mip 糊化/颗粒/TAA 残迹）
// 不可根治且视觉贡献趋零——overlay 输出按相机地心高度渐隐：<50km 全显（近地/航空体验域
// 零影响）→ ≥300km 全隐（干净蓝色地球）。fade 只作用于 overlay 合成（每帧独立，不污染
// TAA history）；premultiplied 域 rgb/a 同乘——fade=0 逐位透传场景。
/** 渐隐起始高度（米）：以下全显。 */
export const CLOUDS_HEIGHT_FADE_START_DEFAULT = 5e4
/** 渐隐终止高度（米）：以上全隐。 */
export const CLOUDS_HEIGHT_FADE_END_DEFAULT = 3e5

/**
 * 相机地心高度 → 云 overlay 合成系数（1=全显，0=全隐）。
 * smoothstep 反向；start≥end 病态区间防御性返回 1（不隐）。
 */
export function computeCloudsHeightFade(
  heightMeters: number,
  start: number = CLOUDS_HEIGHT_FADE_START_DEFAULT,
  end: number = CLOUDS_HEIGHT_FADE_END_DEFAULT
): number {
  if (start >= end) return 1
  const t = Math.min(1, Math.max(0, (heightMeters - start) / (end - start)))
  return 1 - t * t * (3 - 2 * t)
}

/** 模块内 impl（spec §6.1 v2）：一次装配的全部资源 + 每帧逻辑 + 完整销毁。
 *  overlay 已移出 impl（per-handle 资源，spec §6.2）——impl 销毁清单不含 overlay。 */
interface CloudsStageImpl {
  readonly cloudsPass: CloudsPass
  /** M4 resolve pass（temporal 时；overlay uniform 源切换用，spec §6.1 v2 新增）。 */
  readonly resolvePass: CloudsResolvePass | undefined
  readonly cascades: CascadedShadowMaps
  readonly shadowPass: ShadowPass | undefined
  readonly shadowState: CloudsShadowFrameState
  readonly params: CloudsParameters
  /** T9 调试：WeatherAtlas 句柄（mode getter 消费；undefined = atlas 跳过创建的 dummy 路径）。 */
  readonly atlas: WeatherAtlas | undefined
  /** T9 调试：atlas 跳过创建时的 1×1×1 全白 dummy（atlas 非 undefined 时恒 undefined）。 */
  readonly atlasFallbackDummy: Texture3D | undefined
  /** T6 天气预设热切（写 params/state 闭包引用；undefined=清除回创建基线）。 */
  setWeatherPreset(preset: CloudsWeatherPreset | undefined): void
  onPreRender(time: JulianDate): void
  destroy(): void
}

/**
 * buildImpl（spec §7）：装配体整体构建（原 createCloudsStage 主体移入，不挂 listener——
 * preRender listener 由 createCloudsStage 顶层挂一次、经 impl 间接调用）。闭包量
 * （state/scratch/prevCamera/matricesFrozen/inverseMatrices…）全在本函数内 = per-impl
 * 状态，换 impl 自然归零（shadowFreeze 的 freeze 语义从新 impl 重新起算，spec §7）。
 * quality 三路接线（spec §5/§6）：编译开关（applied.main）/ uniform（applied.params）/
 * BSM 结构（applied.shadow 的 cascadeCount/mapSize）——applied 每次调用由调用方新建
 * （applyQualityPreset 产物 deep-clone 新对象，勿跨 impl 共享）。
 *
 * @param scene Cesium scene（cloudsPass.primitive add 到 scene.primitives；overlay 已移出 impl，顶层管理）。
 * @param luts 大气 LUT（与 AtmosphereStage 共享）。
 * @param weather weather 噪声纹理（shape + shapeDetail）。
 * @param options 用户原始选项（clouds 开关 + CloudsPassOptions 透传 + temporal/shadow 编排开关）。
 * @param applied 档位解析产物（含用户显式合并后的三路配置）。
 */
function buildCloudsStageImpl(
  scene: Scene,
  luts: AtmosphereLUTs,
  weather: WeatherTextures,
  options: CloudsStageOptions,
  applied: AppliedCloudsQuality
): CloudsStageImpl {
  const ellipsoid = scene.globe.ellipsoid
  // Cesium 公开 .d.ts 缺 drawingBufferWidth/Height（同 CloudsPass/ShadowPass 局部 augment 模式）
  const context = (scene as unknown as {
    context: Context & { drawingBufferWidth: number; drawingBufferHeight: number }
  }).context

  // ── M4 temporal 开关（默认关——收敛抖动待修，见 CloudsStageOptions 注释；URL 显式开）──
  // temporal 默认 true（2026-09-02 拍板对齐源库；?cloudsTemporal=0 逃生门）。
  // 显式 false 才关——注意 `=== false` 判定使 undefined（未传）走默认开。
  const temporal = options.temporal !== false
  const shadowTemporal = options.shadowTemporal === true

  // ── 业务参数同源（M3 T5 上提）：CloudsPass 与 ShadowPass/共享 uniform 段共用一份 ──
  // （若各自 defaultCloudsParameters() 会得两份独立对象——默认值恰好一致但参数化后漂移；
  // 注入 options.parameters 后 createCloudsPass 内 `options.parameters ?? default` 取到同一份）
  // ── 质量档位解析（spec §5：缺省→档位→用户显式；产物 deep-clone 新对象）──
  // T4 三路已全接线：params（uniform 维）+ applied.main（编译开关）+ applied.shadow
  //（BSM 结构 cascadeCount/mapSize）；applied 由调用方传入（勿在本函数重复 resolve）。
  const params: CloudsParameters = applied.params

  // ── T6 altitudeOffset 派生链（spec §6.1，红队 BLOCKER-4 闭环）──
  // 仅显式传时派生：applyAltitudeOffset（L0/L1 加 clamp 偏移）→ packLayerUniforms 重算全部
  // 15 项层 packed uniforms。不传保持 defaults 写死值（零回归 + 防 clobber 用户显式层参数）；
  // 写死值保留为 T2 单测锚（cloudsDefaultParameters.ts 不改值）。
  if (options.altitudeOffsetM != null) {
    Object.assign(
      params,
      packLayerUniforms(applyAltitudeOffset(DEFAULT_CLOUD_LAYERS, options.altitudeOffsetM))
    )
  }

  // 【2026-09-04 甲内近水平 march LOD】云内步 mip 调制倍率注入（仅显式传时覆盖；缺省
  // CloudsPass `?? 1` 兜底=空区步同款调制）
  if (options.hitStepMipBoost != null) {
    params.hitStepMipBoost = options.hitStepMipBoost
  }

  // 【2026-09-04 march 实验参数直通】单变量 perf 分解用（demo ?cloudsMaxIter/?cloudsMinTrans/
  // ?cloudsToSunIter/?cloudsMaxStep=）——仅显式传时覆盖档位值，缺省走 quality 档不动。
  if (options.maxIterationCount != null) params.maxIterationCount = options.maxIterationCount
  if (options.minTransmittance != null) params.minTransmittance = options.minTransmittance
  if (options.maxIterationCountToSun != null) {
    params.maxIterationCountToSun = options.maxIterationCountToSun
  }
  if (options.maxStepSize != null) params.maxStepSize = options.maxStepSize

  // ── 每帧可变状态（createCloudsStage 持有；preRender 更新；CloudsPass uniformMap 闭包读引用）──
  // T6 atlas 字段：atlasTexture 由下方 WeatherAtlas 创建注入（或 skip-path dummy）；
  // 时间轴三键 preRender 每帧覆写（首帧前缺省——首帧 preRender 先于渲染执行，不外露）。
  const state: CloudsFrameState = {
    sunDirection: new Cartesian3(0, 0, 1),
    moonDirection: new Cartesian3(0, 0, 1),
    moonIlluminatedFraction: 0,
    altitudeCorrection: new Cartesian3(),
    atlasTexture: undefined,
    windOffset: new Cartesian2(),
    shapeWindOffset: new Cartesian3(),
    detailWindOffset: new Cartesian3(),
    atlasT: 0,
    itczCenterSin: 0,
    climateBandsFloor: CLIMATE_BANDS_FLOOR_DEFAULT
  }

  // ── T6 WeatherAtlas（spec §4/§6）：烘焙或 PNG 包装；escape = atlasDisabled（?cloudsAtlas=0）──
  // pngFallback 源 = loadWeatherTextures 留存的原始 PNG decode 数据（烘焙异常兜底 + escape
  // 静态图包装两用）。v1：Atlas 跟随 impl 生命周期（buildImpl 建 / destroy 毁）——烘焙输入
  // 不变时 setQuality 换档重烘属无谓开销，可接受；跨 impl 缓存留待后续（spec §4.3 留口）。
  const weatherPngForFallback = weather.localWeatherRaw
  let atlas: WeatherAtlas | undefined
  let atlasFallbackDummy: Texture3D | undefined
  if (options.atlasDisabled === true) {
    if (weatherPngForFallback != null) {
      // escape：旧静态图 64 层平铺包装（不烘焙，T8 对照基线）。usePngFallback=显式
      // escape 开关（T8 CRITICAL 分派语义修复）——pngFallback 参数已降级为纯兜底材料。
      // 烘焙输入组（plan 语义）同样透传——repeat/演化/风速在 fallback 路径行为与烘焙
      // 路径一致（T6 fix：T8 复测发现 repeat 联动缺口，fallback 不是参数语义阉割版）。
      atlas = createWeatherAtlas({
        context,
        ...options.weatherBake,
        usePngFallback: true,
        pngFallback: weatherPngForFallback
      })
    } else {
      // 极端：PNG decode 已失败（loadWeatherTextures 无 raw）——无包装源，warn+跳过创建，
      // 下方 1×1×1 全白 dummy 顶上（满 coverage 连续云墙，同旧 2D decode 失败降级语义）
      console.warn('[clouds] atlasDisabled 但 weather 无原始 PNG 数据（decode 失败），跳过 Atlas 创建 → 1×1×1 全白 dummy 降级')
    }
  } else {
    atlas = createWeatherAtlas({ context, ...options.weatherBake, pngFallback: weatherPngForFallback })
  }
  if (atlas != null) {
    state.atlasTexture = atlas.atlasTexture
  } else {
    atlasFallbackDummy = new Texture3D({
      context,
      source: { width: 1, height: 1, depth: 1, arrayBufferView: new Uint8Array([255, 255, 255, 255]) },
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
      flipY: false
    })
    state.atlasTexture = atlasFallbackDummy
  }
  // ── stage 层外圈异常防泄漏（T6 评审遗留①，T8 顺手修）：atlas 创建后主体中段抛错
  //（CloudsPass/ShadowPass/resolvePass 构造等）时已建 atlas(~16MB GPU)/fallback dummy 会悬挂
  //——catch 内先释放再 rethrow（烘焙内层防护在 WeatherAtlas bakeAtlas，此处管 impl 装配段）。
  try {
    // 时间轴 plan：正常路径读 atlas.plan（烘焙输入单源）；skip 路径退默认计划（时间轴纯函数
    // 仍工作——atlasT/windOffset 照常推进，只是纹理是静态 dummy）
    const timelinePlan = atlas?.plan ?? resolveWeatherAtlasPlan({})

    // ── T6 fix（T8 复测缺口）：采样端 repeat 与 plan.weatherRepeat 联动（spec §6.2 参数
    // 语义补全）——「降 repeat 去壁纸」此前只改了 windOffset 换算 tileKm 一半，march 的
    // uv×localWeatherRepeat 仍写死 100。weatherRepeat 属烘焙输入组（创建时定死），buildImpl
    // 一次赋值即可；escape/pngFallback/skip 三路径同源 timelinePlan 行为一致。缺省 100=
    // defaults 写死值（零回归）。注意：此处有意覆盖用户显式 parameters.localWeatherRepeat
    // ——repeat 单源 plan（两者同时显式时 plan 赢，spec §6.2 参数分组语义）。
    params.localWeatherRepeat = new Cartesian2(
      timelinePlan.weatherRepeat,
      timelinePlan.weatherRepeat / 2
    ) // 经纬域（方案 A 2026-09-03）：y=经向一半（保瓦物理方形，等距圆柱纬向全跨度=π）

    const sunInertialScratch = new Cartesian3()
    const moonOriginScratch = new Cartesian3()
    const icrfScratch = new Matrix3()
    const normalScratch = new Cartesian3()
    // world 分支量化太阳 scratch（spec §3.1.8：仅矩阵输入量化，逐帧覆写复用）
    const qSunScratch = new Cartesian3()

    // ── M3 BSM：cascade 矩阵 + shadowState + 生成 pass ──
    // T4 质量档位：cascadeCount/mapSize 单源 applied.shadow（= 档位 shadow.cascadeCount/
    // mapSize，spec §4 单一来源规则；define 侧经 applied.main.shadowCascadeCount 投影同值）
    const cascadeCount = applied.shadow.cascadeCount // = shader #define SHADOW_CASCADE_COUNT = CASCADE_COUNT
    const mapSize = applied.shadow.mapSize // high=512（three 默认）；low/medium=256、ultra=1024
    // BSM 有效距离上限（2026-08-28 远端深色斑）：最远 cascade texel ≈ 2·(far段宽)/512；
    // far=2e5 时 texel ~1km → frontDepth 精度崩 → 远端云过暗斑块。60km 时最远 texel ~200m。
    // T4 far 不变式（spec §6 v2）后仅 frustum 分支消费——world 分支 shadowState.far 单源
    // cascades.far（= worldIntervals[cascadeCount]），SHADOW_FAR_LIMIT 不再独立参与。
    const SHADOW_FAR_LIMIT = 6e4
    // BSM 锚定模式（T4，spec v3）：缺省 world；frustum = AB 对照基线（bit 级现行为）。
    // 构造期一次定死（cascades 分支选择）——运行期不切换。
    const worldAnchor = (options.shadowAnchor ?? 'world') === 'world'
    // world 分支：anchor 之外全走类内缺省设计值（worldRadii {16,33.6,96}km、worldIntervals
    // {0,10,21,60}km——Global Constraints：设计值单源于类缺省，编排不重复传；
    // options.worldRadii 显式传时覆盖（E1' 归因实验 radii×N），intervals 不开口）
    const cascades = new CascadedShadowMaps({
      cascadeCount,
      mapSize,
      ...(worldAnchor ? { anchor: 'world' as const } : {}),
      ...(worldAnchor && options.worldRadii != null ? { worldRadii: options.worldRadii } : {})
    })

    // shadowState 数组用新分配实例（勿复用 params.shadowMatrices/shadowIntervals 默认数组：
    // 默认 shadowMatrices 元素是 Object.freeze 的全局 Matrix4.IDENTITY——Matrix4.clone 逐项
    // 覆写会抛 TypeError（ESM 严格模式写冻结对象），且即使可写也会污染全局 identity 常量）。
    // CloudsPass uniformMap 闭包读 state.shadow 引用，preRender 逐帧覆写即可。
    // T4：长度按 cascadeCount 生成（原固定 3 元素——low 档 2 级联时须 2，spec §6）。
    const shadowMatrices = Array.from({ length: cascadeCount }, () => new Matrix4())
    const shadowIntervals = Array.from({ length: cascadeCount }, () => new Cartesian2())
    const shadowState: CloudsShadowFrameState = {
      matrices: shadowMatrices,
      intervals: shadowIntervals,
      cameraNear: 0,
      far: 0, // preRender 首帧填（T4 不变式：world=cascades.far；frustum=min(frustum.far, maxRayDistance, SHADOW_FAR_LIMIT)）
      texelSize: new Cartesian2(1 / mapSize, 1 / mapSize),
      bsm: undefined
    }

    // ── CloudsPass（custom Primitive pass=VOXELS + MRT + 全 business uniform）──
    // M4 T6：temporal 时 temporalUpscale=true（march 1/4 分 + velocity 写 att1）
    // T4 质量档位：编译开关走 resolved（spec §5 覆盖序——applied.main 已合并用户显式，
    // 此处整体覆盖 ...options 展开的原始键）。shadowCascadeCount 顶层必传（Ruling 1：
    // define 单源投影——漏传则 low 档主 march define 恒 3）。
    const cloudsPass = createCloudsPass(scene, luts, weather, state, {
      ...options,
      shapeDetail: applied.main.shapeDetail,
      turbulence: applied.main.turbulence,
      accurateSunSkyLight: applied.main.accurateSunSkyLight,
      lightShafts: applied.main.lightShafts,
      shadowCascadeCount: applied.main.shadowCascadeCount,
      parameters: params,
      temporalUpscale: temporal,
      // 涂抹修复 T1（2026-09-02）：applied.upscaleDivisor 已按「用户显式 > 档位 > 4」合并——
      // 防止 options.upscaleDivisor 原键（若有）漏档位合并，这里显式覆盖为 applied 值
      upscaleDivisor: applied.upscaleDivisor
    })

    // ── ShadowPass 生成端（options.shadowPass=false 跳过——诊断基线 Beer=1）──
    const enableShadow = options.shadowPass !== false
    // 生成端 turbulence dummy（与 CloudsPass 同款 1×1 中性灰 (128,128,128)——sampleMedia
    // TURBULENCE 分支采样；两端各自持有便于独立 destroy）
    const shadowTurbulenceDummy = enableShadow
      ? new Texture({
          context,
          source: {
            width: 1,
            height: 1,
            arrayBufferView: new Uint8Array([128, 128, 128, 255])
          },
          pixelFormat: PixelFormat.RGBA,
          pixelDatatype: PixelDatatype.UNSIGNED_BYTE
        })
      : undefined

    // BSM 专属 inverseShadowMatrices[CASCADE_COUNT]（shadow.frag cascade() z=-1 反投影太阳侧
    // 起点）：preRender 逐帧覆写的 mutable 数组，uniform 闭包持引用。
    const inverseMatrices = shadowMatrices.map(() => new Matrix4())

    // shadow uniformMap = 共享段（与主 march 同源闭包）+ BSM 专属（反投影矩阵 + shadowMarch 档
    // 平铺——Cesium uniformMap 不支持 struct；同名 maxIterationCount 等与主 march 档不同值，
    // 故 march 档不进共享段、各端自绑）。u_cascadeIndex 由 ShadowPass 内部注入（勿重复绑）。
    // D7 frame 拆分：BSM 生成端的 stbn jitter 相位只在 shadowTemporal 开时递增（关 = M3 恒 0）。
    const shadowUniformMap: { [name: string]: () => unknown } = {
      ...buildSharedCloudsUniforms(scene, luts, weather, state, params, shadowTurbulenceDummy!),
      frame: () => (shadowTemporal ? params.frame : 0),
      inverseShadowMatrices: () => inverseMatrices,
      // shadowMarch 档（qualityPresets.ts defaults.shadow：50/100/1000/1e-5/1e-5/1e-4/2）
      maxIterationCount: () => params.shadowMarch.maxIterationCount,
      minStepSize: () => params.shadowMarch.minStepSize,
      maxStepSize: () => params.shadowMarch.maxStepSize,
      minDensity: () => params.shadowMarch.minDensity,
      minExtinction: () => params.shadowMarch.minExtinction,
      minTransmittance: () => params.shadowMarch.minTransmittance,
      opticalDepthTailScale: () => params.shadowMarch.opticalDepthTailScale
    }

    const shadowPass: ShadowPass | undefined = enableShadow
      ? createShadowPass({
          context,
          cascadeCount,
          mapSize,
          // RGBA16F 作 FBO color attachment 需 colorBufferHalfFloat——resolveCloudsHdrDatatype
          // 检测恰好覆盖（HALF_FLOAT→FLOAT→UNSIGNED_BYTE 兜底）；FBO 不完整时 render 内部
          // warn+跳过（消费端保全 0 Beer=1 降级，不炸）
          pixelDatatype: resolveCloudsHdrDatatype(scene),
          uniformMap: shadowUniformMap,
          // 编译分支与主 march 同步（BSM 与主 march 的云密度必须同分布——shapeDetail/turbulence
          // 单端关闭会造成阴影与云形错位）。T4 起读 resolved（applied.main，spec §6 点名的
          // options.shapeDetail ?? true 错位点——low 档 shapeDetail=false 未传时旧写法给
          // 生成端 true）。历史坑（M3 终审修复）保留备忘：本字面量曾无条件建键 + 透传
          // undefined，ShadowMaterial 的 {...DEFAULTS, ...options} 被「显式 undefined 键」
          // 覆盖默认 true（spread 按键存在性覆盖）→ 生成端不 define 而主 march define；
          // applied 值恒布尔（applyQualityPreset 已 ?? 档位），坑天然不复发。
          // cascadeCount 不入 shaderOptions——单源走顶层 options.cascadeCount（ShadowPass
          // 内部透传 define，Task 3）。
          shaderOptions: {
            shapeDetail: applied.main.shapeDetail,
            turbulence: applied.main.turbulence
          },
          // M4：BSM temporal（velocity 层 + resolve ping-pong + prevMatrices 编排）
          temporalPass: shadowTemporal
        })
      : undefined

    if (enableShadow) {
      state.shadow = shadowState
      // 创建即全 0（ShadowPass allocZeroedTexels）→ 首帧 render 前采样 Beer=1，与 dummy
      // 同降级语义（T4 concern：可直接赋值，不必等首次 render）
      shadowState.bsm = shadowPass?.bsmTexture
    }

    // ── M4 云 resolve Pass（temporal 时；primitive add 在 march 之后——D1 执行顺序契约：
    //    同 pass=VOXELS 内 PrimitiveCollection 数组序 → update 顺序 → commandList 序）──
    const resolvePass: CloudsResolvePass | undefined = temporal
      ? createCloudsResolvePass({
          context,
          width: context.drawingBufferWidth,
          height: context.drawingBufferHeight,
          pixelDatatype: resolveCloudsHdrDatatype(scene),
          colorBuffer: cloudsPass.colorTexture,
          depthVelocityBuffer: cloudsPass.depthVelocityTexture,
          frame: () => params.frame,
          varianceGamma: params.temporalVarianceGamma,
          temporalAlpha: params.temporalAlpha,
          temporalDisocclusion: params.temporalDisocclusion,
          upscaleDivisor: applied.upscaleDivisor
        })
      : undefined
    if (resolvePass != null) {
      ;(scene.primitives as unknown as { add: (p: unknown) => void }).add(resolvePass.primitive)
    }

    // ── preRender：每帧更新 sunDirection（Simon1994 + ICRF→Fixed）+ altitudeCorrection（密切球）──
    // 仿 AtmosphereStage.ts:568-604。state 更新后 CloudsPass uniformMap 闭包自动反映（同引用）。
    // M4 temporal 状态：上帧相机快照（velocity reprojection 用；首帧 undefined → fallback 当前
    // 矩阵，velocity=0——three previousProjectionMatrix ?? camera.projectionMatrix 同款）。
    // T4（spec §7 v2）：本函数不挂 listener——每帧逻辑为 impl.onPreRender，由顶层
    // createCloudsStage 的零直捕 listener 调用；prevCamera/matricesFrozen 是 per-impl 状态
    //（换 impl 自然归零——freeze 语义从新 impl 重新起算）。
    let prevCamera: TemporalCameraSnapshot | undefined
    // 静止冻结判定（2026-09-02）：上帧相机位置（temporal 时更新；首帧 undefined=必动→frame++）
    let prevCameraPos: Cartesian3 | undefined
    // 运动自适应 α（T2，2026-09-02）：上帧 look 方向（旋转分量）+ 当前 α 状态（lerp 平滑）
    let prevDirWC: Cartesian3 | undefined
    let motionAlphaCurrent: number | undefined
    // 诊断冻结状态（?cloudsShadowFreeze=1）：首帧 update 过后置 true
    let matricesFrozen = false
    const onPreRender = (time: JulianDate): void => {
      const camera = scene.camera

      // ── M4 temporal：swap 最前（D2：swap 后 history=上帧输出、resolve=待写）+ frame 递增
      //    （D7：单端全关时不递增；march/BSM 生成端的 frame uniform 已按各端开关拆分绑定）──
      // 【静止冻结 2026-09-02】相机静止时 frame 不递增——Bayer jitter/STBN 相位恒定 →
      // march currentColor 恒定 → resolve 的 variance clip 收敛 → 输出逐位稳定。
      // 动机：Bayer 16 相位超采样轮换在高对比云区显示层持续抖动（连拍 20-40% 像素逐帧
      // 变化，readPixels 实证 march velocity 正确、抖动源=轮换采样本身；EMA 混合对 16 帧
      // 周期输入稳态无衰减）。运动时恢复轮换（ legitimate 变化掩盖轮换 + temporal 重建
      // 收益主要在运动中）。判定：positionWC 与上帧差 < 0.01m（远小于 1px 的世界投影）。
      resolvePass?.swapBuffers()
      if (temporal || shadowTemporal) {
        if (prevCameraPos != null && Cartesian3.distance(camera.positionWC, prevCameraPos) < 0.01) {
          // 静止：frame 不递增（jitter/STBN 相位冻结）
        } else {
          params.frame++
        }
        // prevCameraPos 在下方 temporal 分支 prevCamera 快照处一并更新（同一 if 内）
      }

      // 密切球再中心化（相机侧；shader 内 camera/scenePos 都用全量 altitudeCorrection）。
      // bottomRadius = ATMOSPHERE_BOTTOM_RADIUS_M（云层 minHeight=750m ≪ atmosphere bottom，密切球 recenter
      // 在 atmosphere bottom 足够覆盖云层范围）。
      getAltitudeCorrectionOffset(
        camera.positionWC,
        ATMOSPHERE_BOTTOM_RADIUS_M,
        ellipsoid,
        state.altitudeCorrection
      )

      // 太阳方向：inertial 系位置 → central-body-fixed → ECEF，单位化。
      // 【ICRF 竞态修复 2026-08-16】与 AtmosphereStage 同款切换
      // computeIcrfToFixedMatrix → computeIcrfToCentralBodyFixedMatrix（XYS 懒加载竞态 +
      // 网络依赖 → GMST fallback 恒有值；详见 AtmosphereStage.ts 同位注释）。
      const sunInertial = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
        time,
        sunInertialScratch
      )
      const icrfToFixed = Transforms.computeIcrfToCentralBodyFixedMatrix(time, icrfScratch)
      if (icrfToFixed != null && sunInertial != null) {
        const sunFixed = Matrix3.multiplyByVector(icrfToFixed, sunInertial, sunInertial)
        const sunMag = Cartesian3.magnitude(sunFixed)
        if (Number.isFinite(sunMag) && sunMag > 1e-15) {
          Cartesian3.normalize(sunFixed, state.sunDirection)
        }

        // 月方向（方向 C，spec §6.5）：origin = camera.positionWC + altitudeCorrection（米）——
        // 与 atmosphere 侧同式同源（spec r2 N2：显式公式，弃「密切球心」二义措辞）。icrfToFixed
        // 复用上方太阳段（同帧共享）。
        Cartesian3.add(camera.positionWC, state.altitudeCorrection, moonOriginScratch)
        computeMoonDirectionECEF(time, icrfToFixed, moonOriginScratch, state.moonDirection)
        // 月相因子：state 两方向 dot 求 elongation（Lambert 球积分；不独立调 core 独立版——
        // 每帧省 Simon1994×2+ICRF×1，spec §4.1 注）
        state.moonIlluminatedFraction = computeMoonIlluminatedFractionFromDirections(
          state.sunDirection,
          state.moonDirection
        )
      }

      // ── T6 云图时间轴（spec §4.1）：CPU float64 mod 后传 uniform（T1 纯函数，同机多 Viewer
      //    clock 同刻 ⇒ 同分布）——evolutionPhaseS 调试钩子仅偏移演化/平流输入，不动太阳 ──
      const tSec = JulianDate.secondsDifference(time, WEATHER_EPOCH)
      const evolutionPhase = options.evolutionPhaseS ?? 0
      state.atlasT = computeEvolutionTNorm(tSec + evolutionPhase, timelinePlan.evolutionPeriodS)
      state.windOffset = computeWindOffsetTiles(tSec + evolutionPhase, timelinePlan.windMps, timelinePlan.tileKm)
      // P1 云内纹理平流：与 coverage 平流同源时间/风速（时钟冻结/evolutionPhase 钩子语义一致），
      // 各自 repeat 纹理域独立 mod 1（float64 CPU 侧，spec §4.1 铁律）
      const shapeOffsets = computeShapeWindOffsets(
        tSec + evolutionPhase,
        timelinePlan.windMps,
        params.shapeRepeat,
        params.shapeDetailRepeat
      )
      state.shapeWindOffset = shapeOffsets.shape
      state.detailWindOffset = shapeOffsets.detail
      const gregorian = JulianDate.toGregorianDate(time)
      state.itczCenterSin = Math.sin(
        (computeItczCenterLatDeg(computeDayOfYear(gregorian.month, gregorian.day)) * Math.PI) / 180
      )

      // ── M4 temporal：Bayer jitter + reprojection 矩阵（march ray 重建偏移 + velocity 两分支消费）──
      // 矩阵域 ECEF（worldToECEF=identity）；preRender 时刻 frustum.projectionMatrix 为完整视锥
      //（multi-frustum 分段前，velocity 数学只用投影 xy 系数与 w → 分段无关，plan D5）。
      // 写入 params 的既有 Matrix4 实例（clone 覆写不换引用——uniformMap 闭包持引用）。
      if (temporal) {
        computeTemporalJitter(
          params.frame,
          cloudsPass.marchWidth,
          cloudsPass.marchHeight,
          params.temporalJitter
        )
        const viewMatrix = camera.viewMatrix
        const projectionMatrix = (camera.frustum as unknown as { projectionMatrix: Matrix4 })
          .projectionMatrix
        buildReprojectionMatrices(prevCamera, viewMatrix, projectionMatrix, camera.inverseViewMatrix, params.temporalJitter, {
          reprojectionMatrix: params.reprojectionMatrix,
          viewReprojectionMatrix: params.viewReprojectionMatrix
        })
        // 帧末存本帧快照（clone——Cesium camera 矩阵是 live 引用，必须拷贝）
        prevCamera = {
          viewMatrix: Matrix4.clone(viewMatrix, new Matrix4()),
          projectionMatrix: Matrix4.clone(projectionMatrix, new Matrix4())
        }
        // ── T2 运动自适应 α（2026-09-02 涂抹+抖动修复）：此刻 prevCameraPos 仍是上帧
        // 位置（下方才更新）——运动标量 = 平移距离 + 方向角变化 × 等效半径（旋转
        // positionWC 不动但画面全动，必须计入）。运动中超阈值时 α 从 temporalAlpha
        // （静止收敛值）平滑升至 motionAlpha——history 重投影错位/拖影的权重下降
        // （快速抖动换细颗粒噪声）；停止后 lerp 回 base 收敛。首帧参考 undefined →
        // motion=0 → α 从 base 起步（history 尚未建立，base 慢收敛更稳）。
        const transM =
          prevCameraPos != null ? Cartesian3.distance(camera.positionWC, prevCameraPos) : 0
        let dirAngle = 0
        if (prevDirWC != null) {
          const d = Cartesian3.dot(prevDirWC, camera.directionWC)
          dirAngle = Math.acos(Math.min(1, Math.max(-1, d)))
        }
        motionAlphaCurrent = computeMotionAlpha(
          transM + dirAngle * MOTION_EQUIV_RADIUS_M,
          params.temporalAlpha,
          params.motionAlpha,
          motionAlphaCurrent ?? params.temporalAlpha
        )
        resolvePass?.setTemporalAlpha(motionAlphaCurrent)

        // 静止冻结判定（2026-09-02）：存上帧相机位置 + T2 上帧 look 方向（块末统一更新）
        prevCameraPos = Cartesian3.clone(camera.positionWC, prevCameraPos ?? new Cartesian3())
        prevDirWC = Cartesian3.clone(camera.directionWC, prevDirWC ?? new Cartesian3())
      }

      // ── M3 BSM：级联矩阵更新 + 生成（sunDirection 更新后，本帧矩阵与光照一致）──
      // preRender 时刻 camera.frustum.near/far 是完整视锥值（multi-frustum 分段前）——
      // cascade 归一化域与 u_shadowCameraNear 同帧同源（T4 concern #1）。
      if (shadowPass != null) {
        // T4 world 分支（spec v3 §3.1）：矩阵输入太阳量化（0.05° 网格——跑钟时矩阵只在
        // 格点跳变，静止相机+慢太阳下矩阵稳定）；march 与消费端 state.sunDirection 保持
        // 精确（§3.1.8）。frustum 分支原引用直传（bit 级现行为）。
        const sunForMatrices = worldAnchor
          ? quantizeSunDirection(state.sunDirection, SUN_QUANT_STEP, qSunScratch)
          : state.sunDirection
        // 虚拟光源距离（仅 frustum 分支：three CloudsEffect.ts:387 语义 lerp(1e6, 1e3, zenith)）。
        // distance 大（晨昏 zenith=0 → 1e6 上限）是安全的：BSM 两端均不消费 clip.z——生成端
        // cascade() 的 march 起点经 getRayNearFar 与云层球壳解析求交（inverseShadowMatrices
        // 的 z=-1 反投影只取 xy），消费端 getShadowUv 只取 clip.xy（正交投影 xy 与 z 解耦）。
        // CascadedShadowMaps 的「distance 过大会超出 ortho 盒深、勿传大值」警告（T1）仅针对
        // 未来引入 clip.z 剔除/依赖的场景，当前管线不受约束。world 分支不传（z 盒解析式定
        // near/far，不消费 distance——spec §3.2）。
        let distance: number | undefined
        if (!worldAnchor) {
          const normal = ellipsoid.geodeticSurfaceNormal(camera.positionWC, normalScratch)
          const zenith = Math.max(0, Cartesian3.dot(state.sunDirection, normal))
          distance = 1e6 + (1e3 - 1e6) * zenith
        }
        // BSM far/near（spec §3.1.5 + T4 far 不变式 spec §6 v2）——world 分支 shadowState.far ≡
        // cascades.far（= worldIntervals[cascadeCount]，updateWorld 内部单源；cascadeCount=2 即
        // 21km）。原 world 分支 far = min(maxRayDistance, SHADOW_FAR_LIMIT)=60km 与 3 级联
        // intervals 末段 60km 相等纯属设计值巧合——两处归一化域分叉（生成端 updateWorld 按
        // intervals[cascadeCount] 归一化、消费端 getFadedCascadeIndex 按 shadowState.far 归一化）
        // 会导致级联选择整体错位，故废除 SHADOW_FAR_LIMIT 的独立参与（far 赋值与 cascades.far
        // 同源）；update 传的 farFrustum 在 world 分支被 updateWorld 忽略。far 仍不随视锥
        //（multi-frustum 缩放时不变）、cameraNear 固定 0（u_shadowCameraNear 源头注入 0）。
        // frustum 分支 bit 级现行为：完整视锥 far 与 maxRayDistance 取小（决策 D6——云 march
        // 不超 maxRayDistance）；2026-08-28 远端深色斑修复再与 SHADOW_FAR_LIMIT 取小——
        // maxRayDistance=200km 时最远 cascade 的 texel 达 ~1km，frontDepth 精度崩 → 远端云
        // 自阴影过暗斑块（屏幕锚定、随相机前进）。收缩到 60km 后三层 split 重排（最远 texel
        // ~200m），远端云走 uv 越界 fallback（光深 0=无自阴影）——低太阳角远端云的自阴影
        // 视觉贡献本就弱。
        const farFrustum = Math.min(camera.frustum.far, params.maxRayDistance, SHADOW_FAR_LIMIT)
        const near = worldAnchor ? 0 : camera.frustum.near
        // ── 静止跳过（T5，spec §3.2）与诊断冻结（?cloudsShadowFreeze=1）正交组合 ──
        // - freeze 激活（开且首帧已过）：update/矩阵覆写整段跳过（T4 行为），render 照常
        //   每帧——freeze 语义是「冻结矩阵重 march」（噪声分解实验：冻结网格上逐帧差 =
        //   非矩阵噪声地板），跳 render 会破坏该语义。
        // - 非 freeze：update 照跑，返回 changed（world = 语义键比较；frustum 恒 true）。
        //   changed=false（矩阵静止帧）→ 矩阵覆写 + setCurrentMatrices + render 全跳——
        //   BSM 纹理内容只依赖矩阵/云场/量化太阳格点，静止帧重 march 必产出相同内容，
        //   跳过即白赚（m7 不变量：跳过帧 shadowMatrices、ShadowPass 内 current/prev
        //   matrices 与 temporal history 三者冻结不变——render 内部的 prev←本帧登记也
        //   不发生，静止期结束后首帧 velocity 用冻结 prev，矩阵连续 → 无假速度）。
        // - shadowTemporal 开时不跳 render：BSM resolve 时序累积依赖逐帧 jitter 相位
        //   （frame 递增）——「重 march 相同内容」前提被 jitter 破坏，跳帧=累积停更。
        const freezeActive = options.shadowFreeze === true && matricesFrozen
        let changed = false
        if (!freezeActive) {
          changed = cascades.update(
            {
              inverseViewMatrix: camera.inverseViewMatrix,
              projectionMatrix: (camera.frustum as unknown as { projectionMatrix: Matrix4 })
                .projectionMatrix,
              near,
              far: farFrustum
            },
            sunForMatrices,
            distance
          )
          if (changed) {
            for (let i = 0; i < cascadeCount; i++) {
              Matrix4.clone(cascades.cascades[i].matrix, shadowMatrices[i])
              Matrix4.clone(cascades.cascades[i].inverseMatrix, inverseMatrices[i])
              shadowIntervals[i].x = cascades.cascades[i].interval.x
              shadowIntervals[i].y = cascades.cascades[i].interval.y
            }
            // M4：本帧矩阵先登记（render 内部 velocity 用 prevMatrices=上帧、末尾 prev ← 本帧）
            shadowPass.setCurrentMatrices(shadowMatrices)
            shadowState.cameraNear = near
            // T4 far 不变式（spec §6）：world 单源 cascades.far；frustum 分支 = farFrustum
            shadowState.far = worldAnchor ? cascades.far : farFrustum
            shadowState.bsm = shadowPass.bsmTexture
          }
          matricesFrozen = true
        }
        if (freezeActive || changed || shadowTemporal) {
          shadowPass.render()
        }
      }
    }

    // ── T6 天气预设热切（spec §6.1 + §5.4 组合语义）──
    // 基线 = 档位/用户显式合并后的 params 值（本 impl 装配时刻快照）——清除预设恢复它，
    // 用户显式 parameters.coverage 优先于默认 0.3 的语义由此保留。filterScale 缩放基线
    // coverageFilterWidths（overcast 0.6 收窄 → 连片）；激活同时抬 state.climateBandsFloor
    // 至 0.6（shader clamp(band, u_climateBandsFloor, 1.3)——「阴天」×副热带谷不退化近晴空）。
    const presetBaseline = {
      coverage: params.coverage,
      coverageFilterWidths: Cartesian4.clone(params.coverageFilterWidths)
    }
    const setWeatherPreset = (preset: CloudsWeatherPreset | undefined): void => {
      if (preset == null) {
        params.coverage = presetBaseline.coverage
        Cartesian4.clone(presetBaseline.coverageFilterWidths, params.coverageFilterWidths)
        state.climateBandsFloor = CLIMATE_BANDS_FLOOR_DEFAULT
        return
      }
      const p = WEATHER_PRESETS[preset]
      params.coverage = p.coverage
      Cartesian4.multiplyByScalar(presetBaseline.coverageFilterWidths, p.filterScale, params.coverageFilterWidths)
      state.climateBandsFloor = CLIMATE_BANDS_FLOOR_PRESET
    }

    // ── impl 组装（spec §7）：完整销毁清单（handle.destroy 与 setQuality 重建共用）──
    // 不含 preRender listener——顶层持有，换 impl 引用即切换。
    return {
      cloudsPass,
      resolvePass,
      shadowPass,
      shadowState,
      cascades,
      params,
      atlas,
      atlasFallbackDummy,
      setWeatherPreset,
      onPreRender,
      destroy(): void {
        // 顺序：先 CloudsPass（消费端，撤 bsm 引用）→ 云 resolve（march 后第二个 VOXELS 实例）→
        // ShadowPass（释放 bsmTexture——T3 concern #4），最后生成端 turbulence dummy。
        // T6：atlas 消费端（march/ShadowPass shader）销毁后再 dispose——atlasFallbackDummy
        // 仅 skip-path 创建。overlay 不在此清单（v2 spec §6.1：per-handle 资源，由顶层
        // handle.destroy/setQuality 失败分支摘）
        cloudsPass.destroy()
        resolvePass?.destroy()
        shadowPass?.destroy()
        shadowTurbulenceDummy?.destroy()
        atlas?.dispose()
        // Texture3D augment 类型未声明 destroy（WeatherAtlas dispose 内同款 cast 调用）
        ;(atlasFallbackDummy as unknown as { destroy(): void } | undefined)?.destroy()
      }
    }
  } catch (e) {
    atlas?.dispose()
    // Texture3D augment 类型未声明 destroy（destroy 清单同款 cast 调用）
    ;(atlasFallbackDummy as unknown as { destroy(): void } | undefined)?.destroy()
    throw e
  }
}

/**
 * 创建体积云 stage（CloudsPass + overlay）并接入 PostProcess 链（spec §7 编排）：
 * 首次 buildImpl + 零直捕 preRender listener + getter 化 handle（setQuality/destroy）。
 *
 * @param scene Cesium scene（cloudsPass.primitive add 到 scene.primitives；overlay 已移出 impl，顶层管理）。
 * @param luts 大气 LUT（与 AtmosphereStage 共享）。
 * @param weather weather 噪声纹理（shape + shapeDetail）。
 * @param options clouds 开关 + CloudsPassOptions 透传 + quality 档位。
 * @returns handle；options.clouds=false 时返 undefined（零回归，demo 可无条件调用）。
 */
export function createCloudsStage(
  scene: Scene,
  luts: AtmosphereLUTs,
  weather: WeatherTextures,
  options: CloudsStageOptions = {}
): CloudsStageHandle | undefined {
  // 零回归：clouds:false（或不传）→ 不创建任何 primitive/stage。
  if (options.clouds !== true) return undefined

  // ── 首次 impl（spec §7）：applied 由顶层解析喂 buildImpl；setQuality 换档时以
  //    「创建时用户显式 options + 新 quality」重新 resolve（用户显式参数保留，§5）──
  const initialQuality = options.quality ?? 'high'
  let impl = buildCloudsStageImpl(scene, luts, weather, options, applyQualityPreset(initialQuality, options))
  let currentQuality: CloudsQualityPreset = initialQuality
  let destroyed = false
  // T6：激活中的天气预设记在 handle 侧——setQuality 重建 impl（params/state 全新）后重放，
  // 预设跨换档保持（buildImpl 自身不读 preset，基线=装配时刻 params，重放语义正确）
  let activePreset: CloudsWeatherPreset | undefined
  if (options.weatherPreset != null) {
    impl.setWeatherPreset(options.weatherPreset)
    activePreset = options.weatherPreset
  }

  // ── 顶层 overlay（spec §6.2 v2）：per-handle 资源，跨 impl 存活（换档只切 uniform 源）。
  //    不自动 add——add 时机移交消费者（demo 走 insertStageBeforeLensFlare；spec §6.3）。──
  //    sampleMode NEAREST：保护云边缘锐利（cloudsBuffer 是 raymarch 像素对齐数据纹理，
  //    LINEAR 会糊边缘）+ atmosphere input dithering 透传（同 tonemap NEAREST 保护的逻辑）。
  //    pixelDatatype resolveCloudsHdrDatatype（spec D6）：线性 HDR RT 承载 >1 段（UNSIGNED_BYTE
  //    会 clip，真 8-bit 设备客观降级）；与 march RT / resolvePass 同源检测。
  const overlayStage = new PostProcessStage({
    name: 'clouds_overlay',
    fragmentShader: OVERLAY_SHADER,
    uniforms: {
      // 闭包读顶层 impl（换档后自动指向新 bridge；setQuality 失败分支摘本 stage 前不会读旧 bridge）。
      // bridge 每帧重新取（防 resize 后 colorTex 引用变更；接口留动态）。
      // temporal 时读 resolve 输出（全分重建后的 cloudsBuffer）；否则 march att0 直读。
      u_cloudsBuffer: () =>
        impl.resolvePass != null
          ? impl.resolvePass.getResolvedBridge()
          : impl.cloudsPass.getColorBridge(),
      // 云曝光（线性域缩放，spec §4.3；URL ?cloudsExposure=N 可调）
      u_cloudsExposure: options.cloudsOverlayExposure ?? CLOUDS_OVERLAY_EXPOSURE_DEFAULT,
      // 【2026-09-03 穿云黑块探针】overlay 数值直显（0=正常；URL ?cloudsOverlayDebug=1 显 a / 2 显 rgb）
      u_overlayDebug: options.overlayDebug ?? 0,
      // 【2026-09-03 高空云层渐隐】每帧按相机地心高度算系数（uniformMap 闭包每帧求值）；
      // heightFade=false（demo ?cloudsFade=0）恒 1。
      u_heightFade: () => {
        if (options.heightFade === false) return 1
        const carto = scene.camera.positionCartographic
        return computeCloudsHeightFade(
          carto.height,
          options.heightFadeStart ?? CLOUDS_HEIGHT_FADE_START_DEFAULT,
          options.heightFadeEnd ?? CLOUDS_HEIGHT_FADE_END_DEFAULT
        )
      }
    },
    sampleMode: PostProcessStageSampleMode.NEAREST,
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: resolveCloudsHdrDatatype(scene)
  })

  // 摘 overlay 的统一出口（handle.destroy 与 setQuality 失败分支共用；remove 失败则自行 destroy）
  const removeOverlay = (): void => {
    if (!scene.postProcessStages.remove(overlayStage)) {
      if (!overlayStage.isDestroyed()) overlayStage.destroy()
    }
  }

  // ── 零直捕 listener（spec §7 v2 写死，评审 MAJOR）：体内零直捕局部量、一切经 impl——
  //    任何漏网直捕会静默驱动已销毁 impl（frame 计数分叉、矩阵停更）。listener 只挂一次，
  //    setQuality 换 impl 引用即切换驱动对象。
  const removePreRender = scene.preRender.addEventListener(
    (_scene: Scene, time: JulianDate) => {
      if (!destroyed) impl.onPreRender(time)
    }
  )

  // ── handle：公开字段 getter 委托 impl（对外形状/只读语义不变，spec §7）──
  const handle: CloudsStageHandle = {
    get cloudsPass() {
      return impl.cloudsPass
    },
    // 顶层 stage（v2 §6.2：跨 impl 引用恒定；创建后未 add，消费者编排）
    get overlayStage() {
      return overlayStage
    },
    // ShadowPass 引用（调试/探针采样 BSM 用；shadowPass=false 时 undefined）
    get shadowPass() {
      return impl.shadowPass
    },
    // BSM 帧状态（matrices/intervals/cameraNear/far——级联投影数值调试用）
    get shadowState() {
      return impl.shadowState
    },
    // CascadedShadowMaps 实例（frusta/bbox 中间量调试用）
    get cascades() {
      return impl.cascades
    },
    // T9 调试：atlas 模式探针（T8 遗留——冒烟脚本此前只能靠 console warn 推断）
    get weatherAtlasMode() {
      return impl.atlas?.mode ?? (impl.atlasFallbackDummy != null ? 'dummy' : undefined)
    },
    setQuality(next: CloudsQualityPreset): void {
      if (destroyed) {
        console.warn('[clouds] setQuality 于 destroy 后调用，no-op')
        return
      }
      if (next === currentQuality) return
      impl.destroy()
      try {
        impl = buildCloudsStageImpl(scene, luts, weather, options, applyQualityPreset(next, options))
        currentQuality = next
        // T6：激活中的预设重放到新 impl（跨换档保持；undefined=无预设，新 impl 天然缺省态）
        if (activePreset != null) impl.setWeatherPreset(activePreset)
      } catch (e) {
        // 原子性（spec §7 v3）+ v2 BLOCKER 修订：顶层 overlay 必须同步摘除——否则残留链上
        // 每帧读已销毁 impl 的悬空 bridge（GL 纹理名已删），静默黑帧/脏画面。
        destroyed = true
        removeOverlay()
        throw e
      }
    },
    // T6 天气预设热切：委托当前 impl（写 params/state 闭包引用即生效）+ handle 侧记忆
    // activePreset（setQuality 重建后重放）。destroy 后 no-op + warn（对齐 setQuality 风格）。
    setWeatherPreset(preset: CloudsWeatherPreset | undefined): void {
      if (destroyed) {
        console.warn('[clouds] setWeatherPreset 于 destroy 后调用，no-op')
        return
      }
      impl.setWeatherPreset(preset)
      activePreset = preset
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      removePreRender()
      impl.destroy()
      removeOverlay()
    }
  }
  return handle
}
