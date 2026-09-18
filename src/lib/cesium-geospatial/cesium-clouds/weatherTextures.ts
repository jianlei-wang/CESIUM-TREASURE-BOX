// weatherTextures.ts — 体积云 weather 噪声纹理加载（M1 T9）
//
// 搬 three-geospatial clouds assets（spec §6 M1 T9）：
//   shape.bin        R8 Uint8 128³（云形状噪声，2MB = 128³×1 byte）
//   shape_detail.bin R8 Uint8 32³（细节噪声，32KB = 32³×1 byte）
//   local_weather.png 2D 512²（LocalWeather size=512；M2 实现 PNG decode + Texture 2D）
//
// format/dimensions 推算自 three 版 CLOUD_SHAPE_TEXTURE_SIZE + 文件大小，M2 云 shader 实际采样时
// 校准（PixelFormat.RED 单通道，WebGL2 sampler3D 采 .r）。three 版还有 procedural 版（CloudShape.ts
// GPU 运行时生成 perlin），本项目 M1 用预计算资产最简，procedural 留作后续优化。
import {
  Texture3D,
  Texture,
  PixelFormat,
  PixelDatatype,
  Sampler,
  TextureWrap,
  TextureMinificationFilter,
  TextureMagnificationFilter
} from 'cesium'
import type { Context } from 'cesium'

// 3D 噪声采样 wrap 必须 REPEAT：shapePosition = position×shapeRepeat 是大值循环采样（fract），
// Cesium Sampler 默认 CLAMP_TO_EDGE 会把采样钉在纹理边缘 → 云噪声退化为常数/条纹（实测 2026-08-14）。
// three 版 Data3DTexture 用 RepeatWrapping 等价。
const WEATHER_SAMPLER = new Sampler({
  wrapS: TextureWrap.REPEAT,
  wrapT: TextureWrap.REPEAT,
  wrapR: TextureWrap.REPEAT,
  minificationFilter: TextureMinificationFilter.LINEAR,
  magnificationFilter: TextureMagnificationFilter.LINEAR
})

// STBN（spatiotemporal blue noise）采样必须 NEAREST：蓝噪声的结构在纹素级，LINEAR 插值会把
// 高频误差能量抹平成中频 → 失去蓝噪声特性（人眼不敏感频段收敛）退化回灰雾。three 版
// STBNLoader 同用 NearestFilter + RepeatWrapping。
const STBN_SAMPLER = new Sampler({
  wrapS: TextureWrap.REPEAT,
  wrapT: TextureWrap.REPEAT,
  wrapR: TextureWrap.REPEAT,
  minificationFilter: TextureMinificationFilter.NEAREST,
  magnificationFilter: TextureMagnificationFilter.NEAREST
})

// local_weather 采样用 textureLod 显式 LOD（sampleWeather 按 mipLevel 降噪）——纹理必须
// generateMipmap 且 minFilter 用 mipmap 链，否则不完整纹理采样返回黑（coverage=0 → 无云）。
// three 版普通 Texture 默认 generateMipmaps=true + LinearMipmapLinearFilter 等价。
const LOCAL_WEATHER_SAMPLER = new Sampler({
  wrapS: TextureWrap.REPEAT,
  wrapT: TextureWrap.REPEAT,
  minificationFilter: TextureMinificationFilter.LINEAR_MIPMAP_LINEAR,
  magnificationFilter: TextureMagnificationFilter.LINEAR
})

export interface WeatherTextures {
  /** 云形状噪声 3D（R8 Uint8 128³）。 */
  shape: Texture3D
  /** 云细节噪声 3D（R8 Uint8 32³）。 */
  shapeDetail: Texture3D
  /** STBN 蓝噪声 3D（R8 Uint8 128×128×64，getSTBN march jitter 用；frame=0 静态采样 layer 0）。 */
  stbn: Texture3D
  /** local_weather 2D（RGBA Uint8 512²，RGBA 通道 = 4 层 packed coverage；decode 失败时 1×1 全白 fallback）。 */
  localWeather: Texture
  /**
   * local_weather.png 原始 decode 数据（T6）：createCloudsStage 的 atlasDisabled escape 用作
   * WeatherAtlas pngFallback 包装源（旧静态图 64 层平铺，不烘焙）。decode 失败时 undefined
   * （escape 退化为 warn+跳过创建）。2D Texture 字段保留零改动——shadow 等其他消费端不受影响。
   */
  localWeatherRaw?: { width: number; height: number; data: Uint8Array }
}

const SHAPE_SIZE = 128
const SHAPE_DETAIL_SIZE = 32
const STBN_SIZE = 128
const STBN_DEPTH = 64

/**
 * PNG decode 为 RGBA 字节（createImageBitmap + OffscreenCanvas 2d，浏览器原生无依赖）。
 * local_weather.png 是 512² RGBA（RGBA 通道 = 4 层 packed coverage）。
 */
async function decodePngRgba(
  blob: Blob
): Promise<{ width: number; height: number; data: Uint8Array }> {
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (ctx == null) throw new Error('OffscreenCanvas 2d context 不可用')
  ctx.drawImage(bitmap, 0, 0)
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()
  return { width: img.width, height: img.height, data: new Uint8Array(img.data.buffer) }
}

/**
 * 加载 weather 纹理（shape + shapeDetail + stbn 3D + localWeather 2D PNG）。
 *
 * localWeather decode 失败（缺资产/浏览器 API 不可用）时 fallback 1×1 全白 dummy（coverage 满，
 * 同 M2 旧 dummy 语义）——此时地平线掠射带是连续云墙，其 inscatter 饱和外缘显形为白线
 * （实测 2026-08-14），仅作降级不阻断。
 *
 * @param context Cesium Context
 * @param baseUrl weather 资产目录（shape.bin/shape_detail.bin/stbn.bin/local_weather.png）
 */
export async function loadWeatherTextures(
  context: Context,
  baseUrl: string
): Promise<WeatherTextures> {
  const [shapeBuf, detailBuf, stbnBuf, weatherPng] = await Promise.all([
    fetch(`${baseUrl}/shape.bin`).then((r) => r.arrayBuffer()),
    fetch(`${baseUrl}/shape_detail.bin`).then((r) => r.arrayBuffer()),
    fetch(`${baseUrl}/stbn.bin`).then((r) => r.arrayBuffer()),
    fetch(`${baseUrl}/local_weather.png`).then((r) => r.blob())
  ])
  // shape/shape_detail: R8 Uint8 3D（推算 128³/32³；M2 云 shader 采样时校准）。
  // PixelFormat.RED 单通道（WebGL2），UNSIGNED_BYTE。
  const shape = new Texture3D({
    context,
    source: {
      width: SHAPE_SIZE,
      height: SHAPE_SIZE,
      depth: SHAPE_SIZE,
      arrayBufferView: new Uint8Array(shapeBuf)
    },
    pixelFormat: PixelFormat.RED,
    pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
    sampler: WEATHER_SAMPLER,
    flipY: false
  })
  const shapeDetail = new Texture3D({
    context,
    source: {
      width: SHAPE_DETAIL_SIZE,
      height: SHAPE_DETAIL_SIZE,
      depth: SHAPE_DETAIL_SIZE,
      arrayBufferView: new Uint8Array(detailBuf)
    },
    pixelFormat: PixelFormat.RED,
    pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
    sampler: WEATHER_SAMPLER,
    flipY: false
  })
  // stbn：R8 128×128×64（takram 从 NVIDIA STBN PNG 逐层打包，apps/data/src/targets/stbn.ts）。
  // 白噪声 dummy（CPU Math.random）会让 march jitter 显形为全屏雪花纹（实测 2026-08-14）——
  // 蓝噪声把误差能量推到人眼不敏感的高频段，静态采样（frame=0）观感平滑。
  const stbn = new Texture3D({
    context,
    source: {
      width: STBN_SIZE,
      height: STBN_SIZE,
      depth: STBN_DEPTH,
      arrayBufferView: new Uint8Array(stbnBuf)
    },
    pixelFormat: PixelFormat.RED,
    pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
    sampler: STBN_SAMPLER,
    flipY: false
  })

  // local_weather：PNG decode → RGBA 2D Texture（flipY=true 等价 three TextureLoader 上传翻转，
  // globeUv 采样方向与 three 版一致）+ generateMipmap（textureLod 显式 LOD 采样需要 mipmap 链，
  // 无 mip 的不完整纹理采样返回黑 → coverage=0 云消失）。decode 失败 fallback 1×1 全白。
  let localWeather: Texture
  let localWeatherRaw: { width: number; height: number; data: Uint8Array } | undefined
  try {
    const { width, height, data } = await decodePngRgba(weatherPng)
    // 原始 RGBA 留一份给 T6 atlasDisabled escape（与 Texture 共享同一 buffer——Texture 构造
    // 仅上传 GPU，JS 侧 buffer 不被接管）
    localWeatherRaw = { width, height, data }
    localWeather = new Texture({
      context,
      source: { width, height, arrayBufferView: data },
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
      sampler: LOCAL_WEATHER_SAMPLER,
      flipY: true
    })
    ;(localWeather as unknown as { generateMipmap: () => void }).generateMipmap()
  } catch (err) {
    console.warn('[clouds] local_weather.png decode 失败，fallback 1×1 全白 dummy（连续云墙+地平线白线）', err)
    localWeather = new Texture({
      context,
      source: { width: 1, height: 1, arrayBufferView: new Uint8Array([255, 255, 255, 255]) },
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
      sampler: LOCAL_WEATHER_SAMPLER
    })
  }
  return { shape, shapeDetail, stbn, localWeather, localWeatherRaw }
}
