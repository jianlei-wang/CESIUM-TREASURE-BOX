/**
 * Volume Engine —— Cesium 适配层
 *
 * 把统一的体数据瓦片请求封装成 VoxelProvider，并提供标量/分类两套 CustomShader
 * 与传递函数纹理。所有体渲染案例共用，避免每个案例重复实现 VoxelPrimitive 细节。
 */

import {
  Cartesian3,
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
  VoxelShapeType,
  type VoxelProvider
} from 'cesium'

export const LUT_WIDTH = 256

export type Bounds = { min: [number, number, number]; max: [number, number, number] }

export type TileRequest = {
  tileLevel: number
  tileX: number
  tileY: number
  tileZ: number
}

export type VolumeProviderOptions = {
  tileSize: number
  levels: number
  bounds: Bounds
  /** 主线程把瓦片请求转交 Worker 并等待 Float32Array 元数据（VEC4） */
  requestTile: (request: TileRequest) => Promise<Float32Array>
  /** Worker 不可用时的兜底空瓦片 */
  fallbackTile: () => Float32Array
}

/** 生成单通道 VEC4 元数据布局的体数据 provider */
export function createVolumeProvider(options: VolumeProviderOptions): VoxelProvider {
  const { tileSize, levels, bounds } = options
  const dim = tileSize + 2
  return {
    shape: VoxelShapeType.BOX,
    dimensions: new Cartesian3(tileSize, tileSize, tileSize),
    paddingBefore: new Cartesian3(1, 1, 1),
    paddingAfter: new Cartesian3(1, 1, 1),
    shapeTransform: Matrix4.IDENTITY,
    globalTransform: Matrix4.IDENTITY,
    minBounds: new Cartesian3(bounds.min[0], bounds.min[1], bounds.min[2]),
    maxBounds: new Cartesian3(bounds.max[0], bounds.max[1], bounds.max[2]),
    names: ['color'],
    types: [MetadataType.VEC4],
    componentTypes: [MetadataComponentType.FLOAT32],
    availableLevels: levels,
    requestData: (req: Partial<TileRequest> & { keyframe?: number }) => {
      void dim
      return options
        .requestTile({
          tileLevel: req.tileLevel ?? 0,
          tileX: req.tileX ?? 0,
          tileY: req.tileY ?? 0,
          tileZ: req.tileZ ?? 0
        })
        .then((metadata) => VoxelContent.fromMetadataArray([metadata]))
    }
  } as unknown as VoxelProvider
}

/** 把 256×1 RGBA 传递函数打包为 GPU 纹理 */
export function makeLutTexture(lut: Uint8Array): TextureUniform {
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

const SHADING = `
  float ndotl = max(dot(normalize(fsInput.attributes.normalEC), normalize(vec3(0.3, 0.5, 0.8))), 0.0);
  float shade = mix(1.0, 0.6 + 0.4 * ndotl, uShading);
`

/** 标量体着色器：VEC4 元数据 .r=数值、.g=有效掩膜，经传递函数纹理映射颜色与透明度 */
export function createScalarShader(initialLut: Uint8Array): CustomShader {
  return new CustomShader({
    uniforms: {
      uTransferFunction: { type: UniformType.SAMPLER_2D, value: makeLutTexture(initialLut) },
      uValueMin: { type: UniformType.FLOAT, value: 0 },
      uValueMax: { type: UniformType.FLOAT, value: 1 },
      uOpacity: { type: UniformType.FLOAT, value: 0.85 },
      uShading: { type: UniformType.FLOAT, value: 0.45 }
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec4 meta = fsInput.metadata.color;
        float value = meta.r;
        float valid = meta.g;
        vec3 color = vec3(0.0);
        float alpha = 0.0;
        if (valid > 0.5) {
          float t = clamp((value - uValueMin) / max(0.000001, uValueMax - uValueMin), 0.0, 1.0);
          vec4 c = texture(uTransferFunction, vec2(t, 0.5));
          color = c.rgb;
          alpha = uOpacity * c.a;
        }
        ${SHADING}
        material.diffuse = color * shade;
        material.alpha = alpha;
      }
    `
  })
}

/** 分类体着色器：VEC4 元数据 .r=分类码、.g=有效掩膜，经分类色板纹理映射颜色 */
export function buildCategoryLut(categories: { code: number; color: [number, number, number] }[]): Uint8Array {
  const lut = new Uint8Array(LUT_WIDTH * 4)
  for (let i = 0; i < LUT_WIDTH; i += 1) {
    const hit = categories.find((c) => c.code === i)
    const color = hit ? hit.color : [120, 120, 120]
    lut[i * 4] = color[0]
    lut[i * 4 + 1] = color[1]
    lut[i * 4 + 2] = color[2]
    lut[i * 4 + 3] = 255
  }
  return lut
}

export function createCategoricalShader(categories: { code: number; color: [number, number, number] }[]): CustomShader {
  return new CustomShader({
    uniforms: {
      uCategoryLut: { type: UniformType.SAMPLER_2D, value: makeLutTexture(buildCategoryLut(categories)) },
      uOpacity: { type: UniformType.FLOAT, value: 0.9 },
      uShading: { type: UniformType.FLOAT, value: 0.4 }
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec4 meta = fsInput.metadata.color;
        float code = floor(meta.r + 0.5);
        float valid = meta.g;
        vec3 color = vec3(0.0);
        float alpha = 0.0;
        if (valid > 0.5 && code >= 0.5) {
          vec4 c = texture(uCategoryLut, vec2((code + 0.5) / 256.0, 0.5));
          color = c.rgb;
          alpha = uOpacity;
        }
        ${SHADING}
        material.diffuse = color * shade;
        material.alpha = alpha;
      }
    `
  })
}
