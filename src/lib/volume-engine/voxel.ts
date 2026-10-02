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
  float shade = mix(1.0, 0.56 + 0.44 * ndotl, uLighting);
`

/** 分地层显隐：按 VEC4 第 4 通道存放的地层码查可见性纹理，隐藏层 alpha 归零 */
const LAYER_GATE = `
          float layerCode = floor(meta.a + 0.5);
          float layerVis = texture(uLayerVis, vec2((clamp(layerCode, 0.0, 255.0) + 0.5) / 256.0, 0.5)).a;
          alpha *= step(0.5, layerVis);
`

/** 生成“地层可见性”256×1 纹理：默认全可见，hiddenCodes 中对应地层码置为不可见 */
export function makeLayerVisibilityTexture(hiddenCodes: Iterable<number>): TextureUniform {
  const lut = new Uint8Array(LUT_WIDTH * 4)
  lut.fill(255)
  for (const code of hiddenCodes) {
    if (code >= 0 && code < LUT_WIDTH) lut[code * 4 + 3] = 0
  }
  return makeLutTexture(lut)
}

/** 标量体着色器：VEC4 元数据 .r=数值、.g=有效掩膜、.a=地层码（开启分地层显隐时），经传递函数纹理映射颜色与透明度 */
export function createScalarShader(initialLut: Uint8Array, options: { layerGating?: boolean } = {}): CustomShader {
  const uniforms = {
    uTransferFunction: { type: UniformType.SAMPLER_2D, value: makeLutTexture(initialLut) },
    uValueMin: { type: UniformType.FLOAT, value: 0 },
    uValueMax: { type: UniformType.FLOAT, value: 1 },
    uOpacity: { type: UniformType.FLOAT, value: 0.85 },
    uLighting: { type: UniformType.FLOAT, value: 0.45 },
    /** 不透明度幂次压缩：>1 更集中于高值，避免低值糊成一片 */
    uDensityGamma: { type: UniformType.FLOAT, value: 1.0 },
    /** 低端软阈值宽度（归一化 0~1），用于柔和裁切 */
    uThresholdSoft: { type: UniformType.FLOAT, value: 0.0 },
    /** 对数映射开关与对数域值域（渗透率等跨数量级属性用） */
    uLogScale: { type: UniformType.FLOAT, value: 0.0 },
    uLogMin: { type: UniformType.FLOAT, value: 0.0 },
    uLogMax: { type: UniformType.FLOAT, value: 1.0 },
    ...(options.layerGating ? { uLayerVis: { type: UniformType.SAMPLER_2D, value: makeLayerVisibilityTexture([]) } } : {})
  }
  return new CustomShader({
    uniforms,
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec4 meta = fsInput.metadata.color;
        float value = meta.r;
        float valid = meta.g;
        vec3 color = vec3(0.0);
        float alpha = 0.0;
        if (valid > 0.5) {
          float t;
          if (uLogScale > 0.5 && value > 0.0) {
            float lv = log(max(value, 0.000001));
            t = clamp((lv - uLogMin) / max(0.000001, uLogMax - uLogMin), 0.0, 1.0);
          } else {
            t = clamp((value - uValueMin) / max(0.000001, uValueMax - uValueMin), 0.0, 1.0);
          }
          vec4 c = texture(uTransferFunction, vec2(t, 0.5));
          float ramp = pow(clamp(c.a, 0.0, 1.0), max(0.05, uDensityGamma));
          float gate = uThresholdSoft > 0.0001 ? smoothstep(0.0, uThresholdSoft, t) : 1.0;
          color = c.rgb;
          alpha = uOpacity * ramp * gate;
          ${options.layerGating ? LAYER_GATE : ''}
        }
        ${SHADING}
        material.diffuse = color * shade;
        material.alpha = alpha;
      }
    `
  })
}

/** 雷达体着色器：VEC4 元数据 .r=反射率、.g=覆盖度、.b=体密度、.a=数据质量
 *  —— 用覆盖度做可见性门控、密度与质量做透明度调制，避免站顶静锥区/远距弱样本被渲染成实体 */
export function createRadarShader(initialLut: Uint8Array): CustomShader {
  return new CustomShader({
    uniforms: {
      uTransferFunction: { type: UniformType.SAMPLER_2D, value: makeLutTexture(initialLut) },
      uValueMin: { type: UniformType.FLOAT, value: 0 },
      uValueMax: { type: UniformType.FLOAT, value: 1 },
      uOpacity: { type: UniformType.FLOAT, value: 0.92 },
      uLighting: { type: UniformType.FLOAT, value: 0.25 },
      uDensityGamma: { type: UniformType.FLOAT, value: 1.0 },
      uThresholdSoft: { type: UniformType.FLOAT, value: 0.02 }
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec4 meta = fsInput.metadata.color;
        float value = meta.r;
        float coverage = clamp(meta.g, 0.0, 1.0);
        float density = clamp(meta.b, 0.0, 1.0);
        vec3 color = vec3(0.0);
        float alpha = 0.0;
        if (coverage > 0.003) {
          float t = clamp((value - uValueMin) / max(0.000001, uValueMax - uValueMin), 0.0, 1.0);
          vec4 c = texture(uTransferFunction, vec2(t, 0.5));
          float ramp = pow(clamp(c.a, 0.0, 1.0), max(0.05, uDensityGamma));
          float gate = smoothstep(0.0, max(0.001, uThresholdSoft), t);
          color = c.rgb;
          alpha = uOpacity * ramp * density * coverage * gate;
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

export function createCategoricalShader(
  categories: { code: number; color: [number, number, number] }[],
  options: { layerGating?: boolean } = {}
): CustomShader {
  const uniforms = {
    uCategoryLut: { type: UniformType.SAMPLER_2D, value: makeLutTexture(buildCategoryLut(categories)) },
    uOpacity: { type: UniformType.FLOAT, value: 0.9 },
    uLighting: { type: UniformType.FLOAT, value: 0.4 },
    ...(options.layerGating ? { uLayerVis: { type: UniformType.SAMPLER_2D, value: makeLayerVisibilityTexture([]) } } : {})
  }
  return new CustomShader({
    uniforms,
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
          ${options.layerGating ? LAYER_GATE : ''}
        }
        ${SHADING}
        material.diffuse = color * shade;
        material.alpha = alpha;
      }
    `
  })
}
