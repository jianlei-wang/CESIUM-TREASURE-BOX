// ShadowPass.ts
//
// M3 T3：BSM 生成端——sun-POV 全屏 march 写 Texture3D 的 cascade 层。
//
// 时机（决策 D2）：createCloudsStage 的 scene.preRender listener 内调 render()——
// 先于云 march（VOXELS pass），且此刻 camera.frustum.near/far 是完整视锥（cascade split 域一致）。
// BSM 不依赖 globe depth（sun-POV 云密度场，零场景几何）→ preRender 合法。
//
// 生成机制（决策 D1）：Cesium Texture3D（HALF_FLOAT RGBA mapSize²×N）+ 裸 GL FBO
// glFramebufferTextureLayer 逐层 attach（WebGL2 允许 TEXTURE_3D attach layer）→ 每 cascade
// 一次全屏 draw。Plan B（layer attach 不可用）：2D FBO + glCopyTexSubImage3D——render() 内部
// 替换，接口不变。
//
// M4 T5 temporal 扩展（temporalPass=true 默认）：
//   - 生成端 bsmTexture depth = cascadeCount*2（前 N 层 BSM 值、后 N 层 velocity：
//     rgba=(frontDepth, velocity.xy, _)，velocity 为 texel 单位——`(vUv-prevUv)*resolution`
//     生成、`*texelSize` resolve 端转回 UV，对称）
//   - 每 cascade 单 draw 双 out（FBO 双 attach att0=层 i、att1=层 N+i；glDrawBuffers 设一次）
//   - render() 内联 resolve：shadowResolve.frag（ShadowResolveMaterial 单 cascade 化）逐
//     cascade 写 resolve Texture3D 层 i → swap（resolve↔history）→ prevMatrices ← 本帧
//   - 编排契约：调用方每帧 cascades.update 后 setCurrentMatrices(本帧矩阵)；render 内部
//     velocity 用 prevMatrices（上帧），首帧 identity → prevClip 巨值 → resolve 端 prevUv
//     越界 rejection 返 current（安全降级，与 three 首帧语义一致）
//   - bsmTexture getter：temporal 时返回 swap 后的 history（= 本帧 resolve 输出）
//
// 「不传 framebuffer 保留外部裸 FBO」机制（已核 Cesium Context.js 源码）：FullscreenPass 的
// DrawCommand 不带 framebuffer → Context.draw 取 `command._framebuffer ?? passState.framebuffer`
// = undefined → beginDraw → bindFramebuffer(context, undefined)——当 `undefined ===
// context._currentFramebuffer`（每帧 endFrame() 置 undefined；preRender 时刻恒成立）时整个
// 函数 no-op，GL 绑定原样保留（我们裸 bind 的 FBO 不被动）。若 _currentFramebuffer 非
// undefined（如 Cesium Framebuffer 曾 bind 过）会 bind null 破坏裸绑定——preRender 时机无此路径。

import {
  Texture3D,
  PixelFormat,
  PixelDatatype,
  Sampler,
  TextureMinificationFilter,
  TextureMagnificationFilter,
  TextureWrap,
  RenderState,
  BoundingRectangle,
  Matrix4,
  Cartesian2
} from 'cesium'
import type { Context } from 'cesium'
import { FullscreenPass } from '../cesium-core'
import { buildCloudsShadowFragmentShader, type ShadowMainOptions } from './ShadowMaterial'
import { buildShadowResolveFragmentShader } from './ShadowResolveMaterial'

// 裸 GL 常量（WebGL2RenderingContext enum 值）
const GL_FRAMEBUFFER = 0x8d40
const GL_COLOR_ATTACHMENT0 = 0x8ce0
const GL_COLOR_ATTACHMENT1 = 0x8ce1
const GL_FRAMEBUFFER_COMPLETE = 0x8cd5
const GL_FRAMEBUFFER_BINDING = 0x8ca6

/**
 * 生成端单次全屏 draw 的抽象（缺省 FullscreenPass；测试注入 stub）。
 * FullscreenPass 依赖 context.createViewportQuadCommand（Cesium Context 深路径），
 * 抽出工厂便于 node 单测。
 */
export interface ShadowDrawPass {
  execute(context: Context): void
  destroy(): void
}

/** draw pass 工厂（缺省 FullscreenPass + RenderState viewport=mapSize；测试注入 stub）。 */
export type ShadowDrawPassFactory = (
  context: Context,
  fragmentShaderSource: string,
  uniformMap: { [name: string]: () => unknown },
  viewportSize: number
) => ShadowDrawPass

/** ShadowPass 构造选项。 */
export interface ShadowPassOptions {
  /** Cesium Context（取 _gl 做裸 FBO 调用）。 */
  context: Context
  /** cascade 数（3；shadow.frag CASCADE_COUNT 同值，BSM Texture3D 的 depth 维）。 */
  cascadeCount: number
  /** BSM 单边尺寸（512）。 */
  mapSize: number
  /** 像素数据类型（缺省 HALF_FLOAT；HALF_FLOAT renderable 检测由调用方 createCloudsStage 传入）。 */
  pixelDatatype?: number
  /** 业务 uniform（weather/LUT/层/march-shadow 档/inverseShadowMatrices——调用方组好）。 */
  uniformMap: { [name: string]: () => unknown }
  /** T2 组装器编译分支开关（缺省全开）。 */
  shaderOptions?: ShadowMainOptions
  /**
   * M4 temporal 开关（默认 true）：velocity 层双 attach + resolve ping-pong。
   * false = M3 行为（单 attach、无 velocity、无 resolve）——诊断基线。
   */
  temporalPass?: boolean
  /** 测试注入 resolve draw pass 工厂；缺省同 createDrawPass。 */
  createResolveDrawPass?: ShadowDrawPassFactory
  /** 测试注入 draw pass 工厂；缺省 FullscreenPass。 */
  createDrawPass?: ShadowDrawPassFactory
}

/** BSM 生成端 Pass 句柄（T4 消费 bsmTexture；T5 preRender 调 render）。 */
export interface ShadowPass {
  /**
   * BSM 纹理（mapSize²×depth，sampler3D）——消费端 clouds.frag shadowBuffer uniform 直传。
   * temporal 时返回 swap 后的 history resolve 纹理（本帧 resolve 输出）；否则生成端 current。
   */
  readonly bsmTexture: Texture3D
  /** 生成一帧 BSM（temporal 时含 resolve + swap）。preRender 调。 */
  render(): void
  /**
   * M4：登记本帧 cascade 矩阵（cascades.update 后、render 前调）。
   * render 内部 velocity 用上帧矩阵（prevMatrices），末尾 prev ← 本帧。
   */
  setCurrentMatrices(matrices: Matrix4[]): void
  /** velocity 层 z 起点（= cascadeCount；temporalPass=false 时无效）。 */
  readonly velocityLayerOffset: number
  /** 释放：裸 FBO + drawPass + resolveDrawPass + 全部 Texture3D。幂等。 */
  destroy(): void
}

// 缺省 draw pass 工厂：FullscreenPass + RenderState.fromCache（viewport=mapSize、depth off）。
// 不传 framebuffer——见文件头「保留外部裸 FBO」机制；RenderState.viewport 在 execute 内 apply。
const defaultCreateDrawPass: ShadowDrawPassFactory = (
  context,
  fragmentShaderSource,
  uniformMap,
  viewportSize
) =>
  new FullscreenPass(context, {
    fragmentShaderSource,
    uniformMap,
    renderState: RenderState.fromCache({
      viewport: new BoundingRectangle(0, 0, viewportSize, viewportSize),
      depthTest: { enabled: false },
      depthMask: false
    })
  })

// Cesium 公开 .d.ts 缺 drawingBufferWidth/Height（Context augment 为空 interface）。局部补最小形状。
interface CesiumContext extends Context {
  drawingBufferWidth: number
  drawingBufferHeight: number
}

/**
 * 对齐 Cesium FBO 状态机（2026-08-28 云影运动错位根因，比 2026-08-18 的 attach 重绑更深一层）。
 *
 * Cesium 的 FBO 绑定是 JS 侧状态机（Context.js bindFramebuffer）：`framebuffer !==
 * context._currentFramebuffer` 才动 GL，且目标为 undefined 时【主动 gl.bindFramebuffer(null)】。
 * 本 pass 裸 gl.bindFramebuffer 绕过它，但 drawPass.execute → Context.draw →
 * beginDraw(cmd._framebuffer ?? passState.framebuffer = undefined) 会走它——当
 * _currentFramebuffer 被外部污染（≠undefined）时，execute 主动绑 null → 该层 draw 画到画布
 * （随后被场景渲染覆盖，无声）→ BSM 层停更而 inverseShadowMatrices 已更新 → 相机运动时近端
 * 云影错位、静止后自洽恢复。污染源实例：AtmosphereStage depthTemporal 的 postRender blit
 * （Scene.js 帧序 preRender→render{...endFrame}→postRender——blit 在 endFrame 后执行，
 * _currentFramebuffer = historyFBO 跨帧存活到下帧 preRender 本 pass）。
 *
 * execute 前显式置 undefined 使状态机 no-op、draw 落在裸绑定的 BSM fbo（语义同 Context.endFrame
 * 的重置；私有字段直写，与本文件 _gl/_texture 等深路径访问同一先例）。
 *
 * WeatherAtlas 逐层烘焙（T5）同款裸 FBO + drawPass.execute 路径——同源导入复用，防两处漂移。
 */
export function syncCesiumFramebufferTracker(context: Context): void {
  ;(context as { _currentFramebuffer?: unknown })._currentFramebuffer = undefined
}

/**
 * 预置全 0 texel 视图（TypedArray 类型随 pixelDatatype 匹配）。
 *
 * HALF_FLOAT 无原生 TypedArray——Uint16Array 位承载（0x0000 = +0.0 half）。Cesium
 * Texture3D.loadBufferSource 对 arrayBufferView 无 TypedArray 类型校验（defined 检查后
 * 直接透传 texSubImage3D，已核 @cesium/engine 源码），Uint16Array 配 HALF_FLOAT 合法。
 * 预置 0 保证首帧生成前消费端采样得 0 光深 → Beer=1（与 M2 dummy shadowBuffer 同降级语义）。
 */
function allocZeroedTexels(texelCount: number, pixelDatatype: number): Uint16Array | Float32Array | Uint8Array {
  if (pixelDatatype === PixelDatatype.HALF_FLOAT) {
    return new Uint16Array(texelCount)
  }
  if (pixelDatatype === PixelDatatype.FLOAT) {
    return new Float32Array(texelCount)
  }
  return new Uint8Array(texelCount)
}

/**
 * 创建 BSM 生成端 Pass（Texture3D + 裸 FBO + 逐 cascade 全屏 draw；temporal 时含 velocity
 * 层 + resolve ping-pong）。
 *
 * @param options 见 ShadowPassOptions。
 */
export function createShadowPass(options: ShadowPassOptions): ShadowPass {
  const context = options.context as CesiumContext
  const cascadeCount = options.cascadeCount
  const mapSize = options.mapSize
  const pixelDatatype = options.pixelDatatype ?? PixelDatatype.HALF_FLOAT
  const temporalPass = options.temporalPass ?? true
  const gl = (context as unknown as { _gl: WebGL2RenderingContext })._gl

  // ── BSM 纹理（immutable storage——有 source 时 Cesium 走 texStorage3D，可逐层 attach）──
  // temporal 时 depth = cascadeCount*2（前 N 层 BSM 值、后 N 层 velocity：rgb=(frontDepth,
  // velocity.xy, _)——velocity 为 texel 单位，`(vUv-prevUv)*resolution` 生成、`*texelSize`
  // resolve 端转回 UV，对称）。LINEAR + CLAMP_TO_EDGE（消费端三线性插值，R 维同 clamp）；
  // flipY=false（flipY=true 时 Cesium Texture3D 会 console.warn）。
  const mkTex3D = (depth: number): Texture3D =>
    new Texture3D({
      context,
      source: {
        width: mapSize,
        height: mapSize,
        depth,
        arrayBufferView: allocZeroedTexels(mapSize * mapSize * depth * 4, pixelDatatype)
      },
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype,
      sampler: new Sampler({
        minificationFilter: TextureMinificationFilter.LINEAR,
        magnificationFilter: TextureMagnificationFilter.LINEAR,
        wrapS: TextureWrap.CLAMP_TO_EDGE,
        wrapT: TextureWrap.CLAMP_TO_EDGE,
        wrapR: TextureWrap.CLAMP_TO_EDGE
      }),
      flipY: false
    })
  const layerDepth = temporalPass ? cascadeCount * 2 : cascadeCount
  const bsmTexture = mkTex3D(layerDepth)

  // ── M4 temporal：resolve ping-pong（两张 depth=N Texture3D）+ prevMatrices ──
  let resolveTex: Texture3D | undefined = temporalPass ? mkTex3D(cascadeCount) : undefined
  let historyTex: Texture3D | undefined = temporalPass ? mkTex3D(cascadeCount) : undefined
  // prevMatrices：velocity 投影用上帧 cascade 矩阵（首帧 identity → prevClip 巨值 →
  // resolve 端 prevUv 越界 rejection 返 current，安全降级——three 首帧同语义）
  const prevMatrices: Matrix4[] = Array.from({ length: cascadeCount }, () =>
    Matrix4.clone(Matrix4.IDENTITY)
  )
  const currentMatrices: Matrix4[] = Array.from({ length: cascadeCount }, () =>
    Matrix4.clone(Matrix4.IDENTITY)
  )

  // ── 裸 GL FBO（Cesium Framebuffer 不支持 attach Texture3D 单层——走 glFramebufferTextureLayer）──
  // ⚠️ M4 feedback loop 修复（2026-08-17 实测 GL_INVALID_OPERATION "Feedback loop formed"）：
  // 生成端与 resolve 端**必须分用两个 FBO**。生成端 att1 挂 velocity 层（bsmTexture 层 N+i），
  // 若 resolve 沿用同一 FBO，att1 残留的 bsmTexture 与 resolve shader 采样的 inputBuffer
  //（= bsmTexture）构成环——Chrome 检出后**静默吞掉该 draw**（BSM resolve 从未真正执行，
  // historyTex 恒全 0）。resolveFBO 只 attach att0，结构上无环；drawBuffers 也是 FBO 级
  // 状态（各自记忆，无需每帧切换）。
  const fbo = gl.createFramebuffer()
  const resolveFbo: WebGLFramebuffer | null = temporalPass ? gl.createFramebuffer() : null

  // ── uniformMap：业务 uniform 展开 + u_cascadeIndex 注入覆盖（T2 shader 侧声明 uniform int；
  // render() 每 draw 前切值，同 shader 复用 ShaderProgram 缓存）。mutable 闭包。
  let cascadeIndex = 0
  // velocity 的 texel 单位换算基底（前者 mapSize、后者 1/mapSize，对称）
  const resolutionScratch = new Cartesian2(mapSize, mapSize)
  const shadowTexelSize = new Cartesian2(1 / mapSize, 1 / mapSize)
  const uniformMap: { [name: string]: () => unknown } = {
    ...options.uniformMap,
    u_cascadeIndex: () => cascadeIndex,
    ...(temporalPass
      ? {
          resolution: () => resolutionScratch,
          reprojectionMatrices: () => prevMatrices
        }
      : {})
  }

  // ── draw pass（缺省 FullscreenPass；shader 用 T2 组装器——temporalPass/cascadeCount 传入编译分支）──
  const fragmentShaderSource = buildCloudsShadowFragmentShader({
    ...(options.shaderOptions ?? {}),
    temporalPass,
    // spec §6：与主 march SHADOW_CASCADE_COUNT 同源——编排层 applied.shadow.cascadeCount 单源。
    // 置于 spread 后：顶层必填值权威，shaderOptions 不得旁路覆盖。
    cascadeCount
  })
  const drawPass = (options.createDrawPass ?? defaultCreateDrawPass)(
    context,
    fragmentShaderSource,
    uniformMap,
    mapSize
  )

  // ── M4 resolve draw pass（temporal 时；shader 用 T3 ShadowResolveMaterial 单 cascade 化）──
  // three ShadowResolveMaterial 默认：varianceGamma=1、temporalAlpha=0.01（BSM 单像素闪烁
  // 显眼 → 极慢混合）。2026-08-28 录屏帧间差分实测：调深（alpha 0.003/gamma 4）无改善——
  // 残余闪动不在 resolve 泄漏率，是 cascade 视锥锚定重建的固有跳变（PCF+resolve+dither
  // 三件套已在位且各自缺一不可，单独去掉任一项闪动放大 3-12×）。
  const resolveUniformMap: { [name: string]: () => unknown } = temporalPass
    ? {
        inputBuffer: () => bsmTexture, // 生成端 current（含 velocity 层）
        historyBuffer: () => historyTex,
        texelSize: () => shadowTexelSize,
        varianceGamma: () => 1,
        temporalAlpha: () => 0.01,
        u_cascadeIndex: () => cascadeIndex
      }
    : {}
  const resolveDrawPass =
    temporalPass && resolveTex != null && historyTex != null
      ? (options.createResolveDrawPass ?? defaultCreateDrawPass)(
          context,
          buildShadowResolveFragmentShader({ cascadeCount }),
          resolveUniformMap,
          mapSize
        )
      : undefined

  // Texture3D raw WebGLTexture handle（裸 FBO attach 用；私有 _texture，cast 访问）
  const rawTex = (bsmTexture as unknown as { _texture: WebGLTexture })._texture

  let destroyed = false
  return {
    velocityLayerOffset: cascadeCount,
    get bsmTexture(): Texture3D {
      // temporal：resolve/history 已在 render 末尾 swap——historyTex = 本帧 resolve 输出
      return (temporalPass && historyTex != null ? historyTex : bsmTexture) as Texture3D
    },
    setCurrentMatrices(matrices: Matrix4[]): void {
      for (let i = 0; i < cascadeCount; i++) {
        Matrix4.clone(matrices[i], currentMatrices[i])
      }
    },
    render(): void {
      if (destroyed) return
      // save：外部 FBO 绑定（可能 null=default framebuffer）——finally 恢复
      const prevFbo = gl.getParameter(GL_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
      gl.bindFramebuffer(GL_FRAMEBUFFER, fbo)
      try {
        if (temporalPass) {
          // 生成段双 draw buffer（att0=BSM 层 i、att1=velocity 层 N+i——同一 draw 双 out）
          gl.drawBuffers([GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT1])
        }
        for (let i = 0; i < cascadeCount; i++) {
          // 每次 attach 前重绑 fbo（防御）：drawPass.execute 在某些帧（滚轮缩放/multi-frustum
          // 分段，Cesium passState.framebuffer 状态机路径不同）会把 FRAMEBUFFER 绑定重置为
          // null——不补绑则 i>=1 的 framebufferTextureLayer 报 "no framebuffer bound" 且该层
          // BSM draw 落空（2026-08-18 用户验收实测，每帧恰好 i=1,2 两次 NULL）。
          gl.bindFramebuffer(GL_FRAMEBUFFER, fbo)
          // 逐层 attach（TEXTURE_3D layer attach；level 0——BSM 无 mipmap）
          gl.framebufferTextureLayer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, rawTex, 0, i)
          if (temporalPass) {
            gl.framebufferTextureLayer(
              GL_FRAMEBUFFER,
              GL_COLOR_ATTACHMENT1,
              rawTex,
              0,
              cascadeCount + i
            )
          }
          // 完整性只在 i===0 查一次（三层同 texture 同格式，一层完整则全完整）。
          // 不完整 → warn + return（降级：消费端 fallback dummy Beer=1——无自阴影，不炸）。
          if (i === 0 && gl.checkFramebufferStatus(GL_FRAMEBUFFER) !== GL_FRAMEBUFFER_COMPLETE) {
            console.warn('[clouds] BSM FBO 不完整，跳过本帧（主 march fallback Beer=1）')
            return
          }
          cascadeIndex = i // 先切 uniform 再 draw（同 draw 内 uniformMap 闭包读到本层值）
          // execute 前对齐 Cesium FBO 状态机（见 syncCesiumFramebufferTracker 注释）——
          // _currentFramebuffer 被外部污染时 execute 会主动绑 null、本层 draw 落画布（层停更）
          syncCesiumFramebufferTracker(context)
          drawPass.execute(context)
        }
        // ── M4 resolve：切 resolveFBO（只挂 att0——生成端 att1 的 velocity 层若残留即成
        //    feedback loop，见 fbo 创建处注释），逐 cascade 写 resolveTex 层 i ──
        if (
          temporalPass &&
          resolveDrawPass != null &&
          resolveTex != null &&
          historyTex != null &&
          resolveFbo != null
        ) {
          gl.bindFramebuffer(GL_FRAMEBUFFER, resolveFbo)
          const rawResolve = (resolveTex as unknown as { _texture: WebGLTexture })._texture
          for (let i = 0; i < cascadeCount; i++) {
            // 同上防御：resolveDrawPass.execute 可能重置 FBO 绑定，每次 attach 前重绑
            gl.bindFramebuffer(GL_FRAMEBUFFER, resolveFbo)
            gl.framebufferTextureLayer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, rawResolve, 0, i)
            if (i === 0 && gl.checkFramebufferStatus(GL_FRAMEBUFFER) !== GL_FRAMEBUFFER_COMPLETE) {
              console.warn('[clouds] BSM resolve FBO 不完整，跳过 resolve（保持 current 直通）')
              break // finally 恢复 prevFbo
            }
            cascadeIndex = i
            // 同生成段：execute 前对齐 Cesium FBO 状态机，防 resolve 首层 draw 落画布
            syncCesiumFramebufferTracker(context)
            resolveDrawPass.execute(context)
          }
          // swap（resolve↔history）+ prevMatrices ← 本帧（下帧 velocity 用）
          const nextResolve = historyTex
          historyTex = resolveTex
          resolveTex = nextResolve
          for (let i = 0; i < cascadeCount; i++) {
            Matrix4.clone(currentMatrices[i], prevMatrices[i])
          }
        }
      } finally {
        // restore：外部 FBO 绑定 + viewport 回 drawingBuffer（RenderState.viewport=mapSize
        // 在 execute 内 apply 过。显式恢复是防御性冗余：viewport 是 GL 全局状态，不随 FBO
        // 绑定切换重置——仅当外部后续代码假设 viewport= drawingBuffer 时兜底）
        gl.bindFramebuffer(GL_FRAMEBUFFER, prevFbo)
        gl.viewport(0, 0, context.drawingBufferWidth, context.drawingBufferHeight)
      }
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      drawPass.destroy()
      resolveDrawPass?.destroy()
      gl.deleteFramebuffer(fbo)
      if (resolveFbo != null) gl.deleteFramebuffer(resolveFbo)
      // Texture3D destroy（augment 类型未声明 destroy，cast 调用——同 CloudsPass 惯例）
      ;(bsmTexture as unknown as { destroy(): void }).destroy()
      ;(resolveTex as unknown as { destroy(): void } | undefined)?.destroy()
      ;(historyTex as unknown as { destroy(): void } | undefined)?.destroy()
    }
  }
}
