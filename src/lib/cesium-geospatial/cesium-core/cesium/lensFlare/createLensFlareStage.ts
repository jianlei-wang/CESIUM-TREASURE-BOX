// phase2b LensFlare 接线层（spec §3 拓扑 + §5.9 集成）。
//
// 职责：把 T1-T9 的 7 个 shader 构建器组装成 Cesium PostProcessStage 树，供 AtmosphereStage
// （或上层）加入 scene.postProcessStages。返回 handle 持所有 stage/composite 引用，便于运行时
// 控制与销毁。
//
// 拓扑（spec §3）：
//   外层 non-series `lensflare` composite（inputPreviousStageTexture=false）
//   ├─ lf_bloom：series composite（inputPreviousStageTexture=true）
//   │   ├─ lf_threshold（get0，读 atmosphere）→ lf_down0 → ... → lf_down4 → lf_up0 → ... → lf_up4
//   │   └─ up[i].u_downLevel = uniform-name string 引用 down[对应级]（I9 强制约束，避同 scale 共享）
//   ├─ lf_preBlur（u_thresholdTexture = uniform-name string 引用 lf_threshold）
//   ├─ lf_occlusion（textureScale 0.0625 标量降分）
//   ├─ lf_features（u_preBlurTexture/u_occlusionTexture = uniform-name string 引用）
//   └─ lf_composite（u_bloomTexture/u_featuresTexture = uniform-name string 引用）
//
// 三条最高风险评审项（接线层强制）：
//   C2  — lf_bloom.stages[0] = lf_threshold（非 down0）：down0 series 前驱是 threshold，确保
//          bloom 链读阈值化结果而非原 atmosphere。
//   I9  — up[i].uniforms.u_downLevel = string 字面量（非 function）：同 textureScale 的 down/up
//          共享 framebuffer，只有 uniform-name 引用才让 Cesium 依赖图把 down[对应] 排在 up[i] 前；
//          function 返回 texture 对象不建依赖 → up 渲染冲刷 down 输出（白屏）。
//          映射：up0→down3, up1→down2, up2→down1, up3→down0, up4→threshold（同 scale 对齐）。
//   I10 — features/composite 的 uniform-name texture 引用全 string 字面量：non-series 兄弟 stage
//          不在 series 链中，只有 uniform-name 显式引用才构建跨 stage 依赖。
//
// u_texelSize：每帧按各 stage **源 RT** 实际尺寸（1/width, 1/height）更新。
// spec §5.2：u_texelSize 是源 texture 的 1/w,1/h（源非目标）。bloom 降分级 stage 的源是降分 RT，
// 故 texelSize 闭包按 stage 的源 textureScale × drawingBuffer 算（Cesium PostProcessStageTextureCache
// 用 Math.ceil(width * scale) 定 RT 尺寸）。

import {
  PostProcessStage,
  PostProcessStageComposite,
  PostProcessStageSampleMode,
  PixelDatatype,
  PixelFormat,
  Cartesian2,
  Texture,
  type Context,
  type Scene
} from 'cesium'
import { buildThresholdFragmentShader } from './threshold.frag'
import { buildBloomDownsampleFragmentShader } from './bloomDownsample.frag'
import { buildBloomUpsampleFragmentShader } from './bloomUpsample.frag'
import { buildPreBlurFragmentShader } from './preBlur.frag'
import { buildFeaturesFragmentShader } from './features.frag'
import { buildOcclusionFragmentShader } from './occlusion.frag'
import { buildCompositeFragmentShader } from './composite.frag'
import { resolvePostHdrDatatype, type AtmosphereFrameState } from '../AtmosphereStage'
import { SUN_ANGULAR_RADIUS } from '../../math/atmosphereParameters'
import {
  UPSAMPLE_RADIUS,
  THRESHOLD_LEVEL_DEFAULT,
  THRESHOLD_RANGE_DEFAULT,
  INTENSITY_DEFAULT,
  GHOST_AMOUNT_DEFAULT,
  HALO_AMOUNT_DEFAULT,
  CHROMATIC_ABERRATION,
  OCCLUSION_TEXTURE_SCALE
} from './lensFlareConstants'

/** LensFlare 可调参数（全部可选，缺省取 lensFlareConstants 默认）。 */
export interface LensFlareOptions {
  /** 总强度（线性域乘 bloom+features，spec §5.6）。 */
  intensity?: number
  /** 阈值电平（threshold soft knee 中心，spec §5.1）。 */
  thresholdLevel?: number
  /** 阈值过渡带宽（spec §5.1）。 */
  thresholdRange?: number
  /** ghost 总强度（spec §5.4）。 */
  ghostAmount?: number
  /** halo 总强度（spec §5.4）。 */
  haloAmount?: number
  /** halo 色散偏移强度（texel 倍数，spec §5.4）。 */
  chromaticAberration?: number
  /** preBlur 软化核偏移倍数（ghost/halo 模糊半径，1.0=默认 9-tap box；>1 更糊更大半径）。 */
  preBlurRadius?: number
/**
 * lf×云交互 #1（2026-08-30）：云覆盖率 bridge（march att0 premultiplied 输出，.a=覆盖率，
 * {_texture,_target} 形态——M5 cloudsShadowLengthBridge 同构）。传入时 occlusion 36 点采样
 * 叠加云遮挡（每点 max(depth 挡, 云 alpha)）——太阳被云挡时 halo/ghost 按覆盖率衰减，
 * 不再穿透云层。闭包返回 undefined（云未就绪/已销毁帧）→ 1×1 a=0 dummy（不挡，等价无云）。
 * 不传（云未开）→ 不编译云采样（shader 逐字节零回归）。
 */
  cloudsOcclusionBridge?: () => { _texture: unknown; _target: number } | undefined
  /**
   * 运行时可变参数快照（2026-09-05 迭代）：传入后所有可调 uniform（intensity/threshold/
   * ghost/halo/preBlur/…）以函数形式读本对象每帧最新值——上层（AtmosphereStage demo 滑块）
   * 只需原地改字段即可实时生效，无需销毁重建 15-stage 树（重建会命中 Cesium stage-name
   * textureCache 陈旧条目 → 重建后 flare 输出丢失）。不传 → 内部快照静态值（零回归）。
   */
  live?: LensFlareLiveParams
}

/** 运行时可变 flare 参数快照（createLensFlareStage options.live 载体，全部字段须齐备）。 */
export interface LensFlareLiveParams {
  /** 总强度（线性域乘 bloom+features，spec §5.6）。 */
  intensity: number
  /** 阈值电平（threshold soft knee 中心，spec §5.1）。 */
  thresholdLevel: number
  /** 阈值过渡带宽（spec §5.1）。 */
  thresholdRange: number
  /** ghost 总强度（spec §5.4）。 */
  ghostAmount: number
  /** halo 总强度（spec §5.4）。 */
  haloAmount: number
  /** halo 色散偏移强度（texel 倍数，spec §5.4）。 */
  chromaticAberration: number
  /** preBlur 软化核偏移倍数（ghost/halo 模糊半径，1.0=默认 9-tap box；>1 更糊更大半径）。 */
  preBlurRadius: number
}

/** LensFlare stage 树句柄：持所有 stage/composite 引用，便于运行时控制与销毁。 */
export interface LensFlareStageHandle {
  /** 外层 non-series composite（加入 scene.postProcessStages 的根）。 */
  readonly lensflareComposite: PostProcessStageComposite
  /** lf_bloom series composite（threshold + down0-4 + up0-4）。 */
  readonly bloomComposite: PostProcessStageComposite
  /** lf_preBlur（ghost/halo 软化核）。 */
  readonly preBlurStage: PostProcessStage
  /** lf_occlusion（sun 投影 + 椭球遮挡，textureScale 0.0625）。 */
  readonly occlusionStage: PostProcessStage
  /** lf_features（9 ghosts + halo + 色散）。 */
  readonly featuresStage: PostProcessStage
  /** lf_composite（线性域加法叠加 atmosphere + (bloom+features)*intensity）。 */
  readonly compositeStage: PostProcessStage
}

// bloom 级数（spec §3）：threshold(get0) + down0-4（5 级，textureScale 0.5→1/32）+ up0-4（5 级）。
const DOWNSAMPLE_SCALES = [0.5, 0.25, 0.125, 0.0625, 0.03125] // down0-4
const UPSAMPLE_SCALES = [0.0625, 0.125, 0.25, 0.5, 1.0] // up0-4
// I9 映射（spec §3 表）：up[i] 的 support（u_downLevel）= 同 scale 的 down 级。
// up0(scale 0.0625)→down3(0.0625), up1→down2, up2→down1, up3→down0, up4(scale 1.0)→threshold(1.0)。
const UP_DOWN_LEVEL_NAMES = ['lf_down3', 'lf_down2', 'lf_down1', 'lf_down0', 'lf_threshold']

/**
 * u_texelSize 闭包工厂：每帧按 stage **源 RT** 尺寸（scene context drawingBuffer × sourceScale）更新。
 *
 * spec §5.2：u_texelSize 是源 texture 的 1/w,1/h（源非目标）。bloom 降分级 stage 的源是降分 RT
 * （series 前驱或 uniform-name 引用 stage 的 textureScale）。例：down4 源是 down3@0.0625，
 * 源 RT 尺寸 ≈ drawingBuffer × 0.0625 → texelSize ≈ 1/(120)（全分 1920 假设），若误用 1/1920
 * 则 13-tap kernel 覆盖范围不足 1/16 → bloom blur 不足/光晕偏窄。
 *
 * 闭包持 module-scratch Cartesian2（避免每帧分配）；scene.context 引用在闭包内取，运行时
 * drawingBufferWidth 随 resize 变化时自动反映。
 */
function texelSizeForSourceScale(scene: Scene, sourceScale: number): () => Cartesian2 {
  const ctx = (scene as unknown as {
    context: { drawingBufferWidth: number; drawingBufferHeight: number }
  }).context
  const scratch = new Cartesian2()
  return () => {
    const w = ctx.drawingBufferWidth * sourceScale
    const h = ctx.drawingBufferHeight * sourceScale
    // max(·,1.0) 防 RT 尺寸极小或 0 时除零（resize 期/极端 textureScale 下兜底）。
    scratch.x = 1.0 / Math.max(w, 1.0)
    scratch.y = 1.0 / Math.max(h, 1.0)
    return scratch
  }
}

/**
 * 组装 LensFlare PostProcessStage 树（spec §3 拓扑 + §5.9 集成）。
 *
 * 不加入 scene.postProcessStages（由 AtmosphereStage / 上层决定何时 add，便于排序与销毁）。
 * uniforms：uniform-name texture 引用用 string 字面量（I9/I10）；每帧动态量（sunDirection/
 * cameraPosition/ellipsoidRadii/exposure）用 function 闭包读 state/scene。
 *
 * Task 10：depthTemporalStageName（可选）= depthTemporal stage 名（temporalEmaEnabled=true 传
 * 'czm_depth_temporal'）。传入时 occlusion 的 depthTexture uniform 指向该 stage（uniform-name
 * string 跨 stage 引用，Cesium textureCache 经 collection.getStageByName 解析为 outputTexture；
 * combine 优先 user uniform 覆盖内建 scene depth），shader 读 texture().a（smoothDepth，raw log-depth
 * EMA），与 atmosphere 同源 smoothDepth 统一消抖。不传（UNSIGNED_BYTE 兜底，无 depthTemporal）时
 * occlusion 不覆盖 depthTexture（Cesium 内建 scene globe depth），shader 用 legacy czm_readDepth。
 */
export function createLensFlareStage(
  scene: Scene,
  state: AtmosphereFrameState,
  options: LensFlareOptions = {},
  depthTemporalStageName?: string
): LensFlareStageHandle {
  const postHdrDatatype = resolvePostHdrDatatype(scene)
  const intensity = options.intensity ?? INTENSITY_DEFAULT
  const thresholdLevel = options.thresholdLevel ?? THRESHOLD_LEVEL_DEFAULT
  const thresholdRange = options.thresholdRange ?? THRESHOLD_RANGE_DEFAULT
  const ghostAmount = options.ghostAmount ?? GHOST_AMOUNT_DEFAULT
  const haloAmount = options.haloAmount ?? HALO_AMOUNT_DEFAULT
  const chromaticAberration = options.chromaticAberration ?? CHROMATIC_ABERRATION
  const preBlurRadius = options.preBlurRadius ?? 1.0

  // live 参数快照（2026-09-05）：传入后各可调 uniform 读闭包每帧最新值——上层（AtmosphereStage
  // demo 滑块）原地改 live 字段即实时生效，免销毁重建（重建命中 Cesium stage-name textureCache
  // 陈旧条目 → 重建后 flare 输出丢失）。未传 → 返回上方静态 fallback（创建时快照，零回归）。
  const live = options.live
  const liveUniform = <K extends keyof LensFlareLiveParams>(
    key: K,
    fallback: number
  ): number | (() => number) => (live ? () => live[key] : fallback)

  // ellipsoid.radiiSquared：occlusion ray-ellipsoid 椭球遮挡用。
  // create 时捕获一次——Ellipsoid 在 app 生命周期内固定，radiiSquared Cartesian3 不变。
  const ellipsoidRadiiSquared = scene.globe.ellipsoid.radiiSquared

  // ── lf_bloom series composite ──────────────────────────────────────────────
  // C2：get0 = lf_threshold（非 down0）。down0 的 series 前驱是 threshold，读阈值化结果。
  // lf×云交互 #2（2026-08-30，用户拍板 A）：
  //   - colorTexture 覆盖为 uniform-name string 'atmosphere'（源钉云前——clouds overlay 在 atmo
  //     与 lf 之间时 bloom 不读含云画面，亮云不误触发光源；clouds=0 时与内建 series input 同源等价；
  //     显式钉死后不再依赖链上 lf 前级是谁，insertStageBeforeLensFlare 重排免疫）。
  //   - u_occlusionTexture = 'lf_occlusion'（uniform-name string 强制依赖，I10 同 preBlur）：
  //     threshold 输出乘 visibility——太阳被云/地形挡时 bloom 整链衰减。
  const threshold = new PostProcessStage({
    name: 'lf_threshold',
    fragmentShader: buildThresholdFragmentShader(),
    uniforms: {
      colorTexture: 'atmosphere', // string 字面量（lf×云 #2：源钉 atmosphere，排云+重排免疫）
      u_occlusionTexture: 'lf_occlusion', // string 字面量（lf×云 #2：bloom 随太阳可见度衰减）
      u_texelSize: texelSizeForSourceScale(scene, 1.0), // 源 = atmosphere（全分）
      u_thresholdLevel: liveUniform('thresholdLevel', thresholdLevel),
      u_thresholdRange: liveUniform('thresholdRange', thresholdRange)
    },
    textureScale: 1.0,
    sampleMode: PostProcessStageSampleMode.NEAREST, // 读 atmosphere，NEAREST 保 input dithering
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: postHdrDatatype
  })

  // down[i] 源 = series 前驱（down[i-1] 或 threshold for down0）。
  // sourceScale 序列：[threshold 1.0, down0 0.5, down1 0.25, down2 0.125, down3 0.0625]。
  const downSourceScales = [1.0, ...DOWNSAMPLE_SCALES.slice(0, -1)]
  const downs = DOWNSAMPLE_SCALES.map(
    (scale, i) =>
      new PostProcessStage({
        name: `lf_down${i}`,
        fragmentShader: buildBloomDownsampleFragmentShader(),
        uniforms: { u_texelSize: texelSizeForSourceScale(scene, downSourceScales[i]) },
        textureScale: scale,
        // §5.7：series 链传播用 LINEAR（双线性插值，下采样/上采样标准做法）。
        sampleMode: PostProcessStageSampleMode.LINEAR,
        pixelFormat: PixelFormat.RGBA,
        pixelDatatype: postHdrDatatype
      })
  )

  // I9：u_downLevel = uniform-name string 字面量（非 function），强制 Cesium 依赖图把 down[对应]
  // 排在 up[i] 前，避同 scale framebuffer 共享导致 up 渲染冲刷 down 输出。
  // up[i] 源 = series 前驱（up[i-1] 或 down4 for up0）。
  // sourceScale 序列：[down4 0.03125, up0 0.0625, up1 0.125, up2 0.25, up3 0.5]。
  const upSourceScales = [DOWNSAMPLE_SCALES[4], ...UPSAMPLE_SCALES.slice(0, -1)]
  const ups = UPSAMPLE_SCALES.map(
    (scale, i) =>
      new PostProcessStage({
        name: `lf_up${i}`,
        fragmentShader: buildBloomUpsampleFragmentShader(),
        uniforms: {
          u_downLevel: UP_DOWN_LEVEL_NAMES[i], // string 字面量（I9）
          u_upsampleRadius: UPSAMPLE_RADIUS,
          u_texelSize: texelSizeForSourceScale(scene, upSourceScales[i])
        },
        textureScale: scale,
        sampleMode: PostProcessStageSampleMode.LINEAR, // §5.7：series 链传播
        pixelFormat: PixelFormat.RGBA,
        pixelDatatype: postHdrDatatype
      })
  )

  const bloomComposite = new PostProcessStageComposite({
    name: 'lf_bloom',
    stages: [threshold, ...downs, ...ups],
    inputPreviousStageTexture: true // series：每 stage 读前驱输出
  })

  // ── non-series 兄弟 stage ──────────────────────────────────────────────────
  // I10：u_thresholdTexture = uniform-name string 引用 lf_threshold（强制依赖，保证 threshold 先渲染）。
  const preBlur = new PostProcessStage({
    name: 'lf_preBlur',
    fragmentShader: buildPreBlurFragmentShader(),
    uniforms: {
      u_thresholdTexture: 'lf_threshold', // string 字面量（I10）
      u_texelSize: texelSizeForSourceScale(scene, 1.0), // 源 = threshold（全分）
      u_blurRadius: liveUniform('preBlurRadius', preBlurRadius)
    },
    textureScale: 1.0,
    sampleMode: PostProcessStageSampleMode.NEAREST,
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: postHdrDatatype
  })

  // occlusion：标量降分（textureScale 0.0625）——36 点 depth 采样网格成本低，输出低分够用。
  // Task 10：depthTemporalStageName 传入时（temporalEmaEnabled=true）shader 用 smoothDepth
  // （texture().a + 1e-4）+ depthTexture uniform 指向 depthTemporal（uniform-name string 跨 stage 引用）；
  // 未传（UNSIGNED_BYTE 兜底）shader 用 legacy czm_readDepth + 不覆盖 depthTexture（Cesium 内建 scene depth）。
  const useSmoothDepth = !!depthTemporalStageName
  const occlusionUniforms: Record<string, unknown> = {
    u_sunDirectionWC: () => state.sunDirection,
    u_cameraPositionWC: () => scene.camera.positionWC,
    u_sunAngularRadius: SUN_ANGULAR_RADIUS,
    u_ellipsoidRadiiSquared: () => ellipsoidRadiiSquared
  }
  if (depthTemporalStageName) {
    // uniform-name string：Cesium textureCache.updateUniformTextures 经 collection.getStageByName 解析
    // 为 depthTemporal.outputTexture（getOutputTexture）；combine 优先 user uniform 覆盖内建 scene depth。
    occlusionUniforms.depthTexture = depthTemporalStageName
  }
  // lf×云交互 #1：云覆盖率 bridge 注入（{_texture,_target}，M5 cloudsShadowLengthBridge 同构）。
  // 桥未就绪帧 → 1×1 a=0 dummy（不挡，等价无云）——惰性构造（真 GL uniform 闭包每帧首调时建，
  // node 测试不调闭包不炸，AtmosphereStage dummy 同模式）。
  if (options.cloudsOcclusionBridge != null) {
    const cloudsBridge = options.cloudsOcclusionBridge
    let cloudsDummy: Texture | undefined
    const cloudsDummyBridge = (): { _texture: unknown; _target: number } => {
      cloudsDummy ??= new Texture({
        context: (scene as unknown as { context: Context }).context,
        source: { width: 1, height: 1, arrayBufferView: new Uint8Array([0, 0, 0, 0]) },
        pixelFormat: PixelFormat.RGBA,
        pixelDatatype: PixelDatatype.UNSIGNED_BYTE
      })
      return cloudsDummy as unknown as { _texture: unknown; _target: number }
    }
    occlusionUniforms.u_cloudsTexture = () => cloudsBridge() ?? cloudsDummyBridge()
  }
  const occlusion = new PostProcessStage({
    name: 'lf_occlusion',
    fragmentShader: buildOcclusionFragmentShader({
      useSmoothDepth,
      cloudsOcclusion: options.cloudsOcclusionBridge != null
    }),
    uniforms: occlusionUniforms,
    textureScale: OCCLUSION_TEXTURE_SCALE,
    sampleMode: PostProcessStageSampleMode.NEAREST,
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: postHdrDatatype
  })

  // I10：u_preBlurTexture/u_occlusionTexture = uniform-name string 引用（强制依赖）。
  const features = new PostProcessStage({
    name: 'lf_features',
    fragmentShader: buildFeaturesFragmentShader(),
    uniforms: {
      u_preBlurTexture: 'lf_preBlur', // string 字面量（I10）
      u_occlusionTexture: 'lf_occlusion', // string 字面量（I10）
      u_texelSize: texelSizeForSourceScale(scene, 1.0), // 源 = preBlur/up4（全分）
      u_ghostAmount: liveUniform('ghostAmount', ghostAmount),
      u_haloAmount: liveUniform('haloAmount', haloAmount),
      u_chromaticAberration: liveUniform('chromaticAberration', chromaticAberration)
    },
    textureScale: 1.0,
    sampleMode: PostProcessStageSampleMode.NEAREST,
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: postHdrDatatype
  })

  // I10：u_bloomTexture/u_featuresTexture = uniform-name string 引用（强制依赖）。
  // lf_up4 = lf_bloom series composite 最后一级（全分 bloom 输出）。
  const composite = new PostProcessStage({
    name: 'lf_composite',
    fragmentShader: buildCompositeFragmentShader(),
    uniforms: {
      u_bloomTexture: 'lf_up4', // string 字面量（I10）：lf_bloom 最后一级
      u_featuresTexture: 'lf_features', // string 字面量（I10）
      u_intensity: liveUniform('intensity', intensity)
    },
    textureScale: 1.0,
    // §5.7：composite 采样 atmosphere 的 input dithering，NEAREST 保噪声经 RT 中转逐像素直通。
    // LINEAR 会插值抹掉 dither → 水波纹回归。
    sampleMode: PostProcessStageSampleMode.NEAREST,
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: postHdrDatatype
  })

  // ── 外层 non-series composite ──────────────────────────────────────────────
  // inputPreviousStageTexture=false：各兄弟 stage 的 colorTexture = composite 输入（atmosphere），
  // 而非 series 前驱；跨 stage 依赖靠 uniform-name string 引用（I10）显式声明。
  //
  // 2026-09-05 修序：lf_occlusion 必须排在 lf_bloom（含 lf_threshold）之前。threshold/features
  // 的 u_occlusionTexture 是 uniform-name string 引用，Cesium 能解析出纹理但**不会**据此对
  // composite 内部子级重排（子级执行顺序 = stages 数组序）。旧顺序把 lf_bloom 放最前 →
  // threshold 渲染时 lf_occlusion 尚未绘制 → 采到全 0 的陈旧 RT → bloom/features 整链为零
  // （geo-lensflare 案例 flare 全不可见的另一根因）。occlusion 仅依赖 scene depth，无内部
  // 前驱，提到首位后每帧先画，threshold（lf_bloom child0）即可读到最新 visibility。
  const lensflareComposite = new PostProcessStageComposite({
    name: 'lensflare',
    stages: [occlusion, bloomComposite, preBlur, features, composite],
    inputPreviousStageTexture: false // non-series
  })

  return {
    lensflareComposite,
    bloomComposite,
    preBlurStage: preBlur,
    occlusionStage: occlusion,
    featuresStage: features,
    compositeStage: composite
  }
}
