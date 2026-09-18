import {
  Texture,
  Texture3D,
  PixelFormat,
  PixelDatatype,
  type Context
} from 'cesium'

// 2D LUT（transmittance 256x64, irradiance 64x16）—— Cesium Texture。
// 默认 sampler 即 CLAMP_TO_EDGE + LINEAR，满足 LUT 采样。
export function createLUT2D(
  context: Context,
  data: Float32Array,
  width: number,
  height: number
): Texture {
  return new Texture({
    context,
    source: { width, height, arrayBufferView: data },
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: PixelDatatype.FLOAT,
    flipY: false
  })
}

// 3D LUT（scattering 256x128x32）—— Cesium Texture3D（@cesium/engine 原生支持）。
// Texture3D 有 _target getter（→ TEXTURE_3D），UniformSampler.set() 读 v._target
// 能正确绑定 sampler3D；ShaderSource 自动注入 precision highp sampler3D。
// 故 PostProcessStage 的 uniforms 可直接传 Texture3D 对象（T5 验证）。
export function createLUT3D(
  context: Context,
  data: Float32Array,
  width: number,
  height: number,
  depth: number
): Texture3D {
  return new Texture3D({
    context,
    source: { width, height, depth, arrayBufferView: data },
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: PixelDatatype.FLOAT,
    flipY: false
  })
}
