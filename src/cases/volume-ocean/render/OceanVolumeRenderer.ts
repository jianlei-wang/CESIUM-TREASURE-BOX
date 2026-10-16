/**
 * 体渲染适配层 —— 唯一直接依赖 Cesium VoxelPrimitive 的模块
 *
 * VoxelPrimitive 在 Cesium 中标注为 Experimental。本文件把其 API、元数据布局、
 * 自定义着色器与裁剪细节全部封装，其余代码只依赖本类的稳定接口，便于在 API 变动
 * 或 WebGL2 不可用时整体回退（supported=false，由上层给出明确提示，而非崩溃）。
 *
 * 数据按 X→Y→Z 顺序（X 最快）组织；元数据为 VEC2 [value, valid]。
 * 深度层先重采样为等间距，使渲染层索引与真实深度线性对应。
 */

import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClippingPlane,
  ClippingPlaneCollection,
  CustomShader,
  Matrix4,
  MetadataComponentType,
  MetadataType,
  PixelDatatype,
  PixelFormat,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  TextureUniform,
  UniformType,
  VoxelContent,
  VoxelPrimitive,
  VoxelShapeType,
  type VoxelProvider,
  type Viewer
} from 'cesium'
import { oceanTransferLut } from '../ocean-tsd.palette'
import { settleRender } from './ocean-render-util'
import type { OceanSceneFrame } from './OceanSceneFrame'

const LUT_WIDTH = 256

export interface OceanVolumeField {
  /** 等间距深度层上的标量场，尺寸 nx×ny×nz（X→Y→Z，X 最快） */
  values: Float32Array
  nx: number
  ny: number
  nz: number
  /** 与 nz 对应的真实深度（米，正值向下，等间距） */
  depths: number[]
  valueMin: number
  valueMax: number
}

export interface OceanVolumeQuality {
  stepSize: number
  screenSpaceError: number
}

function makeLutTexture(lut: Uint8Array): TextureUniform {
  return new TextureUniform({
    typedArray: lut,
    width: LUT_WIDTH,
    height: 1,
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
    repeat: false,
    minificationFilter: TextureMinificationFilter.LINEAR,
    magnificationFilter: TextureMagnificationFilter.LINEAR
  })
}

/** 海洋标量体着色器：VEC2 元数据 .r=数值、.g=有效掩膜，Beer-Lambert 消光避免体块感 */
function createOceanVolumeShader(lut: Uint8Array): CustomShader {
  return new CustomShader({
    uniforms: {
      uTransferFunction: { type: UniformType.SAMPLER_2D, value: makeLutTexture(lut) },
      uValueMin: { type: UniformType.FLOAT, value: 0 },
      uValueMax: { type: UniformType.FLOAT, value: 1 },
      uOpacity: { type: UniformType.FLOAT, value: 0.5 },
      uLighting: { type: UniformType.FLOAT, value: 0.4 },
      uDensityGamma: { type: UniformType.FLOAT, value: 1.0 },
      uExtinction: { type: UniformType.FLOAT, value: 2.2 }
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec2 meta = fsInput.metadata.color;
        float value = meta.r;
        float valid = meta.g;
        vec3 color = vec3(0.0);
        float alpha = 0.0;
        if (valid > 0.5) {
          float t = clamp((value - uValueMin) / max(0.000001, uValueMax - uValueMin), 0.0, 1.0);
          vec4 c = texture(uTransferFunction, vec2(t, 0.5));
          float density = pow(clamp(c.a, 0.0, 1.0), max(0.05, uDensityGamma));
          float extinction = 1.0 - exp(-density * max(0.0, uExtinction));
          color = c.rgb;
          alpha = uOpacity * extinction;
        }
        float ndotl = max(dot(normalize(fsInput.attributes.normalEC), normalize(vec3(0.3, 0.5, 0.8))), 0.0);
        float shade = mix(1.0, 0.6 + 0.4 * ndotl, uLighting);
        material.diffuse = color * shade;
        material.alpha = clamp(alpha, 0.0, 1.0);
      }
    `
  })
}

export class OceanVolumeRenderer {
  readonly supported: boolean
  private viewer: Viewer
  private frame: OceanSceneFrame
  private field: OceanVolumeField | null = null
  private shader: CustomShader | null = null
  private primitive: VoxelPrimitive | null = null
  private clipPlane: ClippingPlane | null = null
  private clipCollection: ClippingPlaneCollection | null = null
  private paletteId = 'temperature'
  private opacity = 0.5
  private quality: OceanVolumeQuality = { stepSize: 1.6, screenSpaceError: 15 }
  private visible = true
  private clip = { enabled: false, azimuth: 45, tilt: 0, offset: 0 }

  constructor(viewer: Viewer, frame: OceanSceneFrame) {
    this.viewer = viewer
    this.frame = frame
    this.supported = OceanVolumeRenderer.detectWebgl2()
  }

  static detectWebgl2(): boolean {
    try {
      const canvas = document.createElement('canvas')
      return !!(canvas.getContext('webgl2') || canvas.getContext('experimental-webgl2'))
    } catch {
      return false
    }
  }

  get isReady(): boolean {
    return this.primitive !== null
  }

  /** 更新标量场并重建体图元（时间 / 变量 / 垂向夸张变化时调用） */
  setField(field: OceanVolumeField): void {
    this.field = field
    this.rebuild()
  }

  setPalette(paletteId: string, options?: { alphaFloor?: number; alphaMax?: number }): void {
    this.paletteId = paletteId
    const lut = oceanTransferLut(paletteId, {
      alphaFloor: options?.alphaFloor ?? 0.42,
      alphaMax: options?.alphaMax ?? 1,
      alphaGamma: 1
    })
    if (this.shader) this.shader.setUniform('uTransferFunction', makeLutTexture(lut))
    this.requestRender()
  }

  setColorRange(min: number, max: number): void {
    if (!this.shader) return
    this.shader.uniforms.uValueMin.value = min
    this.shader.uniforms.uValueMax.value = max
    this.requestRender()
  }

  setOpacity(value: number): void {
    this.opacity = value
    if (this.shader) this.shader.uniforms.uOpacity.value = value
    this.requestRender()
  }

  setDensityGamma(value: number): void {
    if (this.shader) this.shader.uniforms.uDensityGamma.value = value
    this.requestRender()
  }

  setQuality(quality: OceanVolumeQuality): void {
    this.quality = quality
    if (this.primitive) {
      this.primitive.stepSize = quality.stepSize
      this.primitive.screenSpaceError = quality.screenSpaceError
    }
    this.requestRender()
  }

  setVisible(value: boolean): void {
    this.visible = value
    if (this.primitive) this.primitive.show = value
    this.requestRender()
  }

  /** 更新剖切面；offsetPct 为 -100~100 沿法线的相对偏移 */
  setClip(options: { enabled: boolean; azimuth: number; tilt: number; offsetPct: number }): void {
    this.clip.enabled = options.enabled
    this.clip.azimuth = options.azimuth
    this.clip.tilt = options.tilt
    this.clip.offset = options.offsetPct
    this.applyClip()
  }

  private requestRender(frames = 3): void {
    settleRender(this.viewer, frames)
  }

  /** 构建（含 1 层 padding 的）VEC2 元数据 */
  private buildMetadata(field: OceanVolumeField): Float32Array {
    const { nx, ny, nz } = field
    const pdx = nx + 2
    const pdy = ny + 2
    const pdz = nz + 2
    const metadata = new Float32Array(pdx * pdy * pdz * 2)
    const stride = nx * ny
    for (let pz = 0; pz < pdz; pz += 1) {
      // 元数据 z=0 位于体域底部（最深），z=nz-1 位于表层
      const depthLevel = nz - 1 - (pz - 1)
      const k = Math.max(0, Math.min(nz - 1, depthLevel))
      for (let py = 0; py < pdy; py += 1) {
        const sy = Math.max(0, Math.min(ny - 1, py - 1))
        for (let px = 0; px < pdx; px += 1) {
          const sx = Math.max(0, Math.min(nx - 1, px - 1))
          const value = field.values[sx + nx * sy + stride * k]
          const writeIndex = (pz * pdy + py) * pdx + px
          if (Number.isFinite(value)) {
            metadata[writeIndex * 2] = value
            metadata[writeIndex * 2 + 1] = 1
          } else {
            metadata[writeIndex * 2] = 0
            metadata[writeIndex * 2 + 1] = 0
          }
        }
      }
    }
    return metadata
  }

  private rebuild(): void {
    if (!this.supported || !this.field) return
    if (this.viewer.isDestroyed()) return
    this.disposePrimitive()
    const field = this.field
    const { nx, ny, nz } = field

    const provider = {
      shape: VoxelShapeType.BOX,
      dimensions: new Cartesian3(nx, ny, nz),
      paddingBefore: new Cartesian3(1, 1, 1),
      paddingAfter: new Cartesian3(1, 1, 1),
      shapeTransform: Matrix4.IDENTITY,
      globalTransform: Matrix4.IDENTITY,
      minBounds: this.frame.minBounds,
      maxBounds: this.frame.maxBounds,
      names: ['color'],
      types: [MetadataType.VEC2],
      componentTypes: [MetadataComponentType.FLOAT32],
      availableLevels: 1,
      maximumTileCount: 1,
      requestData: () => Promise.resolve(VoxelContent.fromMetadataArray([this.buildMetadata(field)]))
    } as unknown as VoxelProvider

    const lut = oceanTransferLut(this.paletteId, { alphaFloor: 0.42, alphaMax: 1, alphaGamma: 1 })
    this.shader = createOceanVolumeShader(lut)
    this.shader.uniforms.uValueMin.value = field.valueMin
    this.shader.uniforms.uValueMax.value = field.valueMax
    this.shader.uniforms.uOpacity.value = this.opacity

    const primitive = new VoxelPrimitive({
      provider,
      modelMatrix: this.frame.modelMatrix,
      customShader: this.shader,
      calculateStatistics: false
    })
    primitive.stepSize = this.quality.stepSize
    primitive.screenSpaceError = this.quality.screenSpaceError
    primitive.minBounds = this.frame.minBounds
    primitive.maxBounds = this.frame.maxBounds
    primitive.show = this.visible
    this.clipPlane = new ClippingPlane(new Cartesian3(0, 0, -1), 0)
    this.clipCollection = new ClippingPlaneCollection({
      modelMatrix: this.frame.modelMatrix,
      enabled: this.clip.enabled,
      planes: [this.clipPlane]
    })
    primitive.clippingPlanes = this.clipCollection
    this.viewer.scene.primitives.add(primitive)
    this.primitive = primitive
    this.applyClip()
    this.requestRender(4)
  }

  private applyClip(): void {
    if (!this.clipPlane || !this.clipCollection) return
    const az = (this.clip.azimuth * Math.PI) / 180
    const tilt = (this.clip.tilt * Math.PI) / 180
    const nx = Math.cos(tilt) * Math.cos(az)
    const ny = Math.cos(tilt) * Math.sin(az)
    const nz = Math.sin(tilt)
    // 局部包围盒沿法线的半宽
    const half =
      0.5 *
      (Math.abs(nx) * this.frame.widthM + Math.abs(ny) * this.frame.depthM + Math.abs(nz) * this.frame.heightM)
    const s = (this.clip.offset / 100) * half
    const point = new Cartesian3(nx * s, ny * s, -this.frame.heightM / 2 + nz * s)
    this.clipPlane.normal = new Cartesian3(nx, ny, nz)
    this.clipPlane.distance = -(nx * point.x + ny * point.y + nz * point.z)
    this.clipCollection.enabled = this.clip.enabled
    this.requestRender()
  }

  /** 射线与体域包围盒求交，返回交点经纬度与真实深度 */
  pickDepth(scene: Viewer['scene'], windowPosition: Cartesian2): { lon: number; lat: number; depthM: number } | null {
    if (!this.field) return null
    const ray = scene.camera.getPickRay(windowPosition)
    if (!ray) return null
    const inverse = Matrix4.inverse(this.frame.modelMatrix, new Matrix4())
    const origin = Matrix4.multiplyByPoint(inverse, ray.origin, new Cartesian3())
    const dir = Matrix4.multiplyByPointAsVector(inverse, ray.direction, new Cartesian3())
    const min = this.frame.minBounds
    const max = this.frame.maxBounds
    let tmin = 0
    let tmax = Number.POSITIVE_INFINITY
    const o = [origin.x, origin.y, origin.z]
    const d = [dir.x, dir.y, dir.z]
    const lo = [min.x, min.y, min.z]
    const hi = [max.x, max.y, max.z]
    for (let i = 0; i < 3; i += 1) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < lo[i] || o[i] > hi[i]) return null
      } else {
        let t1 = (lo[i] - o[i]) / d[i]
        let t2 = (hi[i] - o[i]) / d[i]
        if (t1 > t2) {
          const tmp = t1
          t1 = t2
          t2 = tmp
        }
        tmin = Math.max(tmin, t1)
        tmax = Math.min(tmax, t2)
        if (tmin > tmax) return null
      }
    }
    const localHit = new Cartesian3(o[0] + d[0] * tmin, o[1] + d[1] * tmin, o[2] + d[2] * tmin)
    const world = Matrix4.multiplyByPoint(this.frame.modelMatrix, localHit, new Cartesian3())
    const cartographic = Cartographic.fromCartesian(world)
    const depthM = Math.max(
      0,
      (this.frame.liftM - cartographic.height) / this.frame.verticalExaggeration
    )
    return {
      lon: (cartographic.longitude * 180) / Math.PI,
      lat: (cartographic.latitude * 180) / Math.PI,
      depthM
    }
  }

  /** 拾取体元素原始值与有效标记 */
  pickVoxel(scene: Viewer['scene'], windowPosition: Cartesian2): { value: number; valid: boolean } | null {
    if (!this.primitive) return null
    const cell = scene.pickVoxel(windowPosition)
    if (!cell || cell.primitive !== this.primitive) return null
    const property = cell.getProperty('color') as Float32Array | undefined
    if (!property) return null
    return { value: property[0], valid: property[1] > 0.5 }
  }

  private disposePrimitive(): void {
    if (this.primitive && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.primitive)
    }
    this.primitive = null
    this.clipPlane = null
    this.clipCollection = null
  }

  dispose(): void {
    this.disposePrimitive()
    this.shader = null
    this.field = null
  }
}
