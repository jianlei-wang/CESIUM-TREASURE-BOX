// WeatherAtlas.ts
//
// 云分布重设计 T5：时间切片 3D weather 图烘焙模块（spec §4.3/§5）。
// 运行时 GPU 烘焙 256²×64 RGBA8 atlas——64 个时间切片做 z 维，采样端三线性插值
// 得到时间连续的云图演化（替代静态 2D PNG 的 evolution hack，见 weatherTime.ts）。
//
// ── Texture3D 构造路径验证（spec §4.3 BLOCKER 修订，2026-09-03 引擎源码实证）──
// @cesium/engine@26.1.0 Renderer/Texture3D.js：
//   - line 29  `source` 是可选字段——无 source 构造合法（提供 width/height/depth 即可，
//     line 109-113 debug 检查二选一）。
//   - line 256 无 source 走 `loadNull(this)` → line 515-530 `gl.texImage3D(..., null)`
//     ——【可变存储】（非 texStorage3D immutable），mip 链由驱动按需分配。
//   ⇒ **所选路径 (a)**：无 source 构造 + 逐层渲染 + `generateMipmap()` 直接可用，
//     无需路径 (b) 的裸 GL texImage3D 重分配兜底。
//   - 对照：带 source 构造走 `loadBufferSource`（line 270-335）`texStorage3D(levels=1)`
//     immutable 存储——generateMipmap 对 immutable 无 mip 级的纹理报 INVALID_OPERATION，
//     故 PNG fallback（带 source）sampler 恒 LINEAR，textureLod 采样 clamp 到 lod0
//     （WebGL2 规范行为：非 mipmap min filter 时 lod 恒 0——质量中间档，非缺陷）。
//
// ── GL 防御（照抄 ShadowPass.ts:322-356 同款，逐条）──
//   1. 裸 gl.createFramebuffer（Cesium Framebuffer 不支持 TEXTURE_3D layer attach）；
//   2. 每次 framebufferTextureLayer 前重绑 FBO（drawPass.execute 在 multi-frustum 分段帧
//      会把 FRAMEBUFFER 绑定重置 null——2026-08-18 实测 i>=1 层 attach 落空）；
//   3. i===0 查一次 checkFramebufferStatus（同 texture 同格式，一层完整则全完整）；
//   4. 每次 execute 前 syncCesiumFramebufferTracker（ShadowPass.ts:161 同源导入——
//      Cesium JS 侧 _currentFramebuffer 状态机被污染时 execute 会主动绑 null，draw 落画布）；
//   5. prevFbo 保存 + finally 恢复 + viewport 回 drawingBuffer。
//
// ── 顶点桥（draw pass 侧）──
// 烘焙 shader 是独立 entry 自带 `in vec2 vUv`（weatherBake.frag:20）。draw pass 顶点侧
// 是 Cesium ViewportQuadVS（Context.js createViewportQuadCommand:1619-1640），varying
// 输出恒为 `out vec2 v_textureCoordinates`（Shaders/ViewportQuadVS.js，st ∈ [0,1]）。
// 一行 object-like macro `#define vUv v_textureCoordinates` 把 fragment 声明与使用整体
// 重定向（CloudsMaterial.ts「桥接 prefix」同款手法、此处更简——唯一 varying）。
// 自带 `#version 300 es` 的 assembler 产物兼容性已核 ShaderSource.js:170-190——
// #version 从任意位置提取重放到最顶；line 206-210 只剥第一个 precision，自带
// `precision highp int` 残留重复声明（GLSL 合法）。不污染 assembler（compile test 共用）。

import {
  BoundingRectangle,
  Cartesian2,
  PixelDatatype,
  PixelFormat,
  RenderState,
  Sampler,
  Texture3D,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  TextureWrap
} from 'cesium'
import type { Context } from 'cesium'
import { FullscreenPass } from '../cesium-core'
import { buildStandaloneWeatherBakeShader } from './weatherBakeAssembler'
import { syncCesiumFramebufferTracker } from './ShadowPass'
import {
  CUBE_FACE_WIDTH_KM,
  WEATHER_BAKE_SEED,
  WEATHER_EVOLUTION_PERIOD_S,
  WEATHER_WIND_SPEED_MPS
} from './weatherTime'

// 裸 GL 常量（WebGL2RenderingContext enum 值，ShadowPass 同款）
const GL_FRAMEBUFFER = 0x8d40
const GL_COLOR_ATTACHMENT0 = 0x8ce0
const GL_FRAMEBUFFER_COMPLETE = 0x8cd5
const GL_FRAMEBUFFER_BINDING = 0x8ca6
const GL_NO_ERROR = 0

/** atlas 平面尺寸（256²，最大 3D 纹理保证内、8 mip 级）。 */
export const ATLAS_SIZE = 256
/** 时间切片数（z 维；周期 5.3h ⇒ 每切片 5min，采样端三线性插值时间连续）。 */
export const ATLAS_SLICES = 64

/** PNG fallback 源图（RGBA8；宽高不限 256——fallback 尺寸随源图）。 */
export interface WeatherPngFallback {
  width: number
  height: number
  data: Uint8Array
}

export interface WeatherAtlasPlan {
  /** 演化环周期（秒）——64 切片扫完一圈；T6 preRender 传时间轴消费。 */
  evolutionPeriodS: number
  /** 平流风速 m/s。 */
  windMps: number
  /** 烘焙种子（bakeSeedToOffset 的输入）。 */
  seed: number
  /** 经向（赤道）weather 平铺瓦数（tileKm = 赤道周长 / repeat；face 缝根治 2026-09-03
   *  方案 A：采样域改经纬度，repeat 语义从「每 cube face 瓦数」改为「经向瓦数」，默认
   *  400 ≈ 旧 face 域 100 瓦/face 的瓦物理尺寸连续；须偶数——经度割缝闭合）。 */
  weatherRepeat: number
  /** 单 tile 弧长 km（T6 采样端 uRepeat/windOffset 换算用；经纬域取赤道瓦宽，
   *  纬向瓦宽 = 赤道/2÷(repeat/2) 数值相同，共用即可）。 */
  tileKm: number
  /** true = 跳过烘焙直接用 PNG fallback（T8 对照/逃生门）。 */
  usePngFallback: boolean
}

export interface WeatherAtlasOptions {
  context: Context
  /** 演化周期（小时）；缺省 5.3（64 切片 × 5min）。 */
  evolutionHours?: number
  /** 平流风速 m/s；缺省 WEATHER_WIND_SPEED_MPS=8。 */
  windMps?: number
  /** 烘焙种子；缺省 WEATHER_BAKE_SEED=1337。 */
  seed?: number
  /** 平铺次数（经向瓦数，须偶数）；缺省 400（经纬域，≈旧 face 域 100 的瓦尺寸）。 */
  weatherRepeat?: number
  /** 烘焙失败的兜底材料（RGBA8 原始 PNG decode 数据）。提供【不】触发直接分派——
   * 旧语义「提供即 fallback」使 T6 无条件传参时 bakeAtlas 死代码（T8 CRITICAL 实证：
   * demo 恒旧静态图 64 层包装）。spec §4.4「烘焙异常时才降级」。 */
  pngFallback?: WeatherPngFallback | undefined
  /** 显式 escape 开关：跳过烘焙直接用 pngFallback 包装（T6 atlasDisabled / ?cloudsAtlas=0
   * 对照基线路径）。与 pngFallback 参数双语义分离（T8 CRITICAL 修复）。 */
  usePngFallback?: boolean
}

/** WeatherAtlas 句柄（T6 preRender 消费 plan 时间轴/atlasTexture 直传采样端 uniform）。 */
export interface WeatherAtlas {
  /** 3D weather 图（256²×64，RGBA8；sampler 见 mode 对应说明）。 */
  atlasTexture: Texture3D
  /** baked = GPU 烘焙（mip 成功 LINEAR_MIPMAP_LINEAR/降级 LINEAR）；pngFallback = 静态图 64 层（LINEAR）。 */
  mode: 'baked' | 'pngFallback'
  /** 解析后的计划（T6 消费 evolutionPeriodS/tileKm/windMps）。 */
  plan: WeatherAtlasPlan
  /** 释放 Texture3D + 裸 FBO + drawPass。幂等。 */
  dispose(): void
}

/**
 * 选项 → 烘焙计划（纯逻辑）。缺省值单源：常量在 weatherTime.ts，此处只补
 * evolutionHours 的 5.3h 字面量（WEATHER_EVOLUTION_PERIOD_S 同值派生）。
 * usePngFallback 只由显式开关派生——pngFallback 参数是兜底材料而非分派开关
 * （T8 CRITICAL 修复）。
 */
export function resolveWeatherAtlasPlan(options: {
  evolutionHours?: number
  windMps?: number
  seed?: number
  weatherRepeat?: number
  pngFallback?: WeatherPngFallback | undefined
  usePngFallback?: boolean
}): WeatherAtlasPlan {
  const weatherRepeat = options.weatherRepeat ?? 400
  return {
    evolutionPeriodS:
      options.evolutionHours != null
        ? options.evolutionHours * 3600
        : WEATHER_EVOLUTION_PERIOD_S,
    windMps: options.windMps ?? WEATHER_WIND_SPEED_MPS,
    seed: options.seed ?? WEATHER_BAKE_SEED,
    weatherRepeat,
    // 经纬域（方案 A 2026-09-03）：tileKm = 赤道周长/经向瓦数。CUBE_FACE_WIDTH_KM×4
    // = 40075.017km 赤道周长（face 域旧公式 /repeat 在 repeat=400 时错 4 倍，不可复用）。
    tileKm: (CUBE_FACE_WIDTH_KM * 4) / weatherRepeat,
    usePngFallback: options.usePngFallback === true
  }
}

/**
 * seed → u_seedOffset 固定采样偏移（确定性 hash——同 seed 两次烘焙逐位同图的前提之一，
 * spec §4.5）。纯函数，无状态。
 *
 * 约束（评审交接注记）：产物须避开烘焙域整频网格点（freq∈{8,16,32,64,128} 的 1/freq
 * 格点，偏移落格点上会使 p+offset 与未偏移域逐位对齐、种子失效）与整数平移（z 向整数
 * 平移对整频域不可见）。sin hash 实测（V8）：seed=1337 → (0.4758, 0.8408)，x*128=60.91、
 * y*128=107.62 均非整（1/128 格点覆盖 freq≤128 全部格点）——单测钉死。
 */
export function bakeSeedToOffset(seed: number): Cartesian2 {
  const frac = (n: number): number => {
    const x = Math.sin(n + 1.951) * 43758.5453
    return x - Math.floor(x)
  }
  return new Cartesian2(frac(seed), frac(seed * 0.731 + 17.7))
}

/**
 * PNG RGBA 平铺 slices 层（z-major 连续——texImage3D arrayBufferView 排布：每层
 * w*h*4 连续块，层序 = z 序）。纯逻辑，单测覆盖。
 *
 * @exception 源 data 长度 ≠ width×height×4 时抛错（防御坏 PNG——texSubImage3D 的
 * 越界读在 GL 侧是未定义行为，提前在 CPU 侧拦截）。
 */
export function tilePngLayers(
  png: { width: number; height: number; data: Uint8Array },
  slices: number
): Uint8Array {
  const layerBytes = png.width * png.height * 4
  if (png.data.length !== layerBytes) {
    throw new Error(
      `[clouds] WeatherAtlas pngFallback data 长度 ${png.data.length} ≠ ${png.width}×${png.height}×4`
    )
  }
  const out = new Uint8Array(layerBytes * slices)
  for (let i = 0; i < slices; i++) {
    out.set(png.data, i * layerBytes)
  }
  return out
}

// Cesium 公开 .d.ts 缺 drawingBufferWidth/Height（ShadowPass 同款局部补形）。
interface CesiumContext extends Context {
  drawingBufferWidth: number
  drawingBufferHeight: number
}

// 顶点桥 macro（见文件头「顶点桥」段）。
const BAKE_VERTEX_BRIDGE = '#define vUv v_textureCoordinates\n'

/** assembler 产物 → draw pass 可喂源：#version 行后插 vUv→v_textureCoordinates 桥。 */
function bridgeBakeShaderForDrawPass(bakeShader: string): string {
  const versionLine = '#version 300 es\n'
  return bakeShader.startsWith(versionLine)
    ? versionLine + BAKE_VERTEX_BRIDGE + bakeShader.slice(versionLine.length)
    : BAKE_VERTEX_BRIDGE + bakeShader
}

/** 耗尽残留 GL error 位（generateMipmap 判定前清场；上限 16 防驱动异常死循环）。 */
function drainGlErrors(gl: WebGL2RenderingContext): void {
  for (let i = 0; i < 16 && gl.getError() !== GL_NO_ERROR; i++);
}

// 引擎实现有 sampler setter（Texture3D.js:564-572）/generateMipmap（:697），公开 .d.ts
// 未声明——cast 补真实形状（同文件 destroy cast、ShadowPass:305 _texture cast 同先例）。
interface Texture3DReal extends Texture3D {
  generateMipmap(hint?: number): void
  sampler: Sampler
}

/** mipmap 采样器（mip 链生成成功后切换；REPEAT 三向——采样端 uv/z 均周期域）。 */
function mipSampler(): Sampler {
  return new Sampler({
    wrapS: TextureWrap.REPEAT,
    wrapT: TextureWrap.REPEAT,
    wrapR: TextureWrap.REPEAT,
    minificationFilter: TextureMinificationFilter.LINEAR_MIPMAP_LINEAR,
    magnificationFilter: TextureMagnificationFilter.LINEAR
  })
}

/** lod0 采样器（构造期/mip 降级共用）。 */
function linearSampler(): Sampler {
  return new Sampler({
    wrapS: TextureWrap.REPEAT,
    wrapT: TextureWrap.REPEAT,
    wrapR: TextureWrap.REPEAT,
    minificationFilter: TextureMinificationFilter.LINEAR,
    magnificationFilter: TextureMagnificationFilter.LINEAR
  })
}

/**
 * 分派依赖注入口（测试接缝，ShadowPass createDrawPass 注入同款模式）——node 单测
 * 锁定分派双语义（pngFallback 兜底 vs usePngFallback 显式 escape），不触真 GL。
 */
export interface WeatherAtlasDispatchDeps {
  bake: (context: Context, plan: WeatherAtlasPlan) => WeatherAtlas
  createFallback: (
    context: Context,
    png: WeatherPngFallback,
    plan: WeatherAtlasPlan
  ) => WeatherAtlas
}

const defaultDispatchDeps: WeatherAtlasDispatchDeps = {
  bake: bakeAtlas,
  createFallback: createPngFallbackAtlas
}

/**
 * 创建 WeatherAtlas（T6 入口）。
 *
 * 分派双语义（T8 CRITICAL 修复，spec §4.4「烘焙异常时才降级」）：
 *   - `usePngFallback: true` = 显式 escape（?cloudsAtlas=0 对照基线）→ 直接 PNG 包装，不烘焙；
 *   - `pngFallback` 参数 = 烘焙失败兜底材料（不短路分派——旧语义使 T6 无条件传参时
 *     bakeAtlas 死代码、demo 恒旧静态图）。
 */
export function createWeatherAtlas(
  options: WeatherAtlasOptions,
  deps: WeatherAtlasDispatchDeps = defaultDispatchDeps
): WeatherAtlas {
  const plan = resolveWeatherAtlasPlan(options)
  if (plan.usePngFallback && options.pngFallback != null) {
    return deps.createFallback(options.context, options.pngFallback, plan)
  }
  if (plan.usePngFallback) {
    // escape 开了但无材料（PNG decode 失败）——烘焙是唯一能产生内容的路径
    console.warn('[clouds] usePngFallback 但无 pngFallback 数据，回退烘焙路径')
  }
  try {
    return deps.bake(options.context, plan)
  } catch (e) {
    if (options.pngFallback != null) {
      console.warn('[clouds] 天气图烘焙失败，降级静态 PNG fallback', e)
      return deps.createFallback(options.context, options.pngFallback, plan)
    }
    throw e
  }
}

/** GPU 烘焙路径：无 source Texture3D + 裸 FBO 逐层全屏 draw + mip 链（见文件头）。 */
function bakeAtlas(context: Context, plan: WeatherAtlasPlan): WeatherAtlas {
  const ctx = context as CesiumContext
  const gl = (ctx as unknown as { _gl: WebGL2RenderingContext })._gl

  // 无 source 构造（loadNull → texImage3D 可变存储，见文件头验证结论）。
  // sampler 先 LINEAR——mip 链生成成功后切 LINEAR_MIPMAP_LINEAR（降级链第一级）。
  // 顶层 width/height/depth 字段引擎实现支持（Texture3D.js:78），.d.ts 未声明——cast。
  const atlasTexture = new Texture3D({
    context: ctx,
    width: ATLAS_SIZE,
    height: ATLAS_SIZE,
    depth: ATLAS_SLICES,
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
    sampler: linearSampler(),
    flipY: false
  } as unknown as ConstructorParameters<typeof Texture3D>[0]) as Texture3DReal

  // Texture3D 私有 _texture 句柄（裸 FBO attach 用；cast 访问同 ShadowPass:305 先例）
  const rawTex = (atlasTexture as unknown as { _texture: WebGLTexture })._texture
  const fbo = gl.createFramebuffer()

  // 异常路径资源回收：ShaderProgram 编译是 lazy 的（FullscreenPass 首次 execute 才真正
  // 编译 GLSL）——编译失败在烘焙循环内 throw，此时 WeatherAtlas 对象未返回、dispose
  // 不可达 → fbo+atlasTexture（256²×64×4 ≈ 16MB GPU）泄漏，无 fallback 时调用方重试
  // 逐次 +16MB。atlasTexture 构造自身无此窗口（无 source 路径 debug 检查全在
  // createTexture 之前，Texture3D.js:109-199 vs :216——createTexture 后无 throw 点）。
  let drawPass: FullscreenPass | undefined
  const releaseGpuResources = (): void => {
    drawPass?.destroy()
    gl.deleteFramebuffer(fbo)
    ;(atlasTexture as unknown as { destroy(): void }).destroy()
  }

  try {
    // draw pass：一次构造、64 层复用（同 ShaderProgram 缓存，u_slice 闭包切值——
    // ShadowPass u_cascadeIndex 同款 mutable-uniform 模式）。
    let slice = 0
    const seedOffset = bakeSeedToOffset(plan.seed)
    drawPass = new FullscreenPass(ctx, {
      fragmentShaderSource: bridgeBakeShaderForDrawPass(buildStandaloneWeatherBakeShader()),
      uniformMap: {
        u_slice: () => slice,
        u_seedOffset: () => seedOffset
      },
      renderState: RenderState.fromCache({
        viewport: new BoundingRectangle(0, 0, ATLAS_SIZE, ATLAS_SIZE),
        depthTest: { enabled: false },
        depthMask: false
      })
    })

    let fboComplete = true
    // save 外部 FBO 绑定——finally 恢复（烘焙可能在任意帧时点执行）
    const prevFbo = gl.getParameter(GL_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    gl.bindFramebuffer(GL_FRAMEBUFFER, fbo)
    try {
      for (let i = 0; i < ATLAS_SLICES; i++) {
        // 每次 attach 前防御重绑（drawPass.execute 可能重置绑定——文件头防御 2）
        gl.bindFramebuffer(GL_FRAMEBUFFER, fbo)
        gl.framebufferTextureLayer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, rawTex, 0, i)
        // 完整性只在 i===0 查一次（64 层同 texture 同格式——ShadowPass:346 同判定）
        if (
          i === 0 &&
          gl.checkFramebufferStatus(GL_FRAMEBUFFER) !== GL_FRAMEBUFFER_COMPLETE
        ) {
          console.warn('[clouds] WeatherAtlas FBO 不完整，跳过烘焙（atlas 全 0 → 无云降级）')
          fboComplete = false
          break
        }
        slice = i / ATLAS_SLICES // 先切 uniform 再 draw（闭包读本层值）
        syncCesiumFramebufferTracker(ctx) // 文件头防御 4
        drawPass.execute(ctx)
      }
    } finally {
      gl.bindFramebuffer(GL_FRAMEBUFFER, prevFbo)
      gl.viewport(0, 0, ctx.drawingBufferWidth, ctx.drawingBufferHeight)
    }

    if (fboComplete) {
      // mip 链（降级链第一级）：FBO 已解绑。generateMipmap 前清残留 error 位——
      // attach/draw 期间的旧错误否则会被误记到 mip 头上（误降级 LINEAR，行为安全但 warn 误导）。
      drainGlErrors(gl)
      atlasTexture.generateMipmap()
      if (gl.getError() === GL_NO_ERROR) {
        atlasTexture.sampler = mipSampler()
      } else {
        // 中间档：保持 lod0 LINEAR——textureLod 对非 mipmap filter 纹理 clamp lod0
        //（WebGL2 规范），远端像素少 mip 平滑（噪点略增），功能无损。
        console.warn('[clouds] WeatherAtlas generateMipmap 失败，sampler 保持 LINEAR（lod0）')
      }
    }

    let destroyed = false
    return {
      atlasTexture,
      mode: 'baked',
      plan,
      dispose(): void {
        if (destroyed) return
        destroyed = true
        drawPass?.destroy()
        gl.deleteFramebuffer(fbo)
        // Texture3D augment 类型未声明 destroy（ShadowPass:406 同款 cast 调用）
        ;(atlasTexture as unknown as { destroy(): void }).destroy()
      }
    }
  } catch (e) {
    // WeatherAtlas 对象不可达——资源在此回收（内层 finally 已先恢复 FBO 绑定/viewport）
    releaseGpuResources()
    throw e
  }
}

/**
 * PNG fallback 路径：静态图 64 层平铺 + 带 source 构造（immutable texStorage3D
 * levels=1——Texture3D.js:292-296，generateMipmap 不可用），sampler 恒 LINEAR：
 * textureLod 对非 mipmap min filter clamp 到 lod0（WebGL2 规范行为）——远端噪点
 * 略增，逃生门/对照实验可接受（spec §4.3）。
 */
function createPngFallbackAtlas(
  context: Context,
  png: WeatherPngFallback,
  plan: WeatherAtlasPlan
): WeatherAtlas {
  const ctx = context as CesiumContext
  const gl = (ctx as unknown as { _gl: WebGL2RenderingContext })._gl
  const atlasTexture = new Texture3D({
    context: ctx,
    source: {
      width: png.width,
      height: png.height,
      depth: ATLAS_SLICES,
      arrayBufferView: tilePngLayers(png, ATLAS_SLICES)
    },
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
    sampler: linearSampler(),
    flipY: false // flipY=true 时 Texture3D.loadBufferSource console.warn 且不受支持
  })
  let destroyed = false
  return {
    atlasTexture,
    mode: 'pngFallback',
    plan,
    dispose(): void {
      if (destroyed) return
      destroyed = true
      void gl // gl 无自管资源（FBO 不存在）——保留取用形制与 bakeAtlas 对称
      ;(atlasTexture as unknown as { destroy(): void }).destroy()
    }
  }
}
