import { Float16Array } from '@petamoriken/float16'
import { createLUT2D, createLUT3D } from './cesiumTextures'
import type { Context, Texture, Texture3D } from 'cesium'

export interface AtmosphereLUTs {
  transmittance: Texture
  scattering: Texture3D
  irradiance: Texture
  // higher-order scattering LUT（C9，spec 附录 E2/E3 + r2 F1）：云 god rays 需 shadow_length>0，
  // 走 bruneton/runtime.glsl HAS_HIGHER_ORDER_SCATTERING_TEXTURE 分支（只遮 single Rayleigh 保留多阶，
  // 防过暗黑）。8388608 字节 = 256×128×32 half-float RGBA（与 scattering 同格式同维度）。
  higherOrderScattering: Texture3D
}

// .bin 文件是 half-float (Uint16Array) RGBA，逐像素 4 通道。
// 文件大小 = width*height*depth * 4 * 2 字节。
// @petamoriken/float16 的 Float16Array 把 buffer 当 half 视图，Float32Array.from 转 float。
export function parseHalfFloatBin(buffer: ArrayBuffer): Float32Array {
  const f16 = new Float16Array(buffer)
  return Float32Array.from(f16)
}

const TRANSMITTANCE_W = 256,
  TRANSMITTANCE_H = 64
const SCATTERING_W = 256,
  SCATTERING_H = 128,
  SCATTERING_D = 32
const IRRADIANCE_W = 64,
  IRRADIANCE_H = 16

export async function loadAtmosphereLUTs(
  context: Context,
  baseUrl: string
): Promise<AtmosphereLUTs> {
  const [tBuf, sBuf, iBuf, hBuf] = await Promise.all([
    fetch(`${baseUrl}/transmittance.bin`).then(r => r.arrayBuffer()),
    fetch(`${baseUrl}/scattering.bin`).then(r => r.arrayBuffer()),
    fetch(`${baseUrl}/irradiance.bin`).then(r => r.arrayBuffer()),
    fetch(`${baseUrl}/higher_order_scattering.bin`).then(r => r.arrayBuffer())
  ])
  return {
    transmittance: createLUT2D(
      context,
      parseHalfFloatBin(tBuf),
      TRANSMITTANCE_W,
      TRANSMITTANCE_H
    ),
    scattering: createLUT3D(
      context,
      parseHalfFloatBin(sBuf),
      SCATTERING_W,
      SCATTERING_H,
      SCATTERING_D
    ),
    irradiance: createLUT2D(
      context,
      parseHalfFloatBin(iBuf),
      IRRADIANCE_W,
      IRRADIANCE_H
    ),
    higherOrderScattering: createLUT3D(
      context,
      parseHalfFloatBin(hBuf),
      SCATTERING_W,
      SCATTERING_H,
      SCATTERING_D
    )
  }
}
