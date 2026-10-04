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
  type TimeIntervalCollection,
  type VoxelProvider
} from 'cesium'

export const LUT_WIDTH = 256

export type Bounds = { min: [number, number, number]; max: [number, number, number] }

export type TileRequest = {
  tileLevel: number
  tileX: number
  tileY: number
  tileZ: number
  /** 时间关键帧索引（时间动态体数据），缺省为当前时间步 */
  keyframe?: number
}

export type VolumeProviderOptions = {
  tileSize: number
  levels: number
  bounds: Bounds
  /** 时间关键帧数：>1 时启用 Cesium 关键帧插值，实现时间连续播放 */
  keyframeCount?: number
  /** 关键帧时间区间集合（与 keyframeCount 配套） */
  timeIntervalCollection?: TimeIntervalCollection
  /** 主线程把瓦片请求转交 Worker 并等待 Float32Array 元数据（VEC4） */
  requestTile: (request: TileRequest) => Promise<Float32Array>
  /** Worker 不可用时的兜底空瓦片 */
  fallbackTile: () => Float32Array
}

/** 生成单通道 VEC4 元数据布局的体数据 provider */
export function createVolumeProvider(options: VolumeProviderOptions): VoxelProvider {
  const { tileSize, levels, bounds } = options
  const dim = tileSize + 2
  const provider: Record<string, unknown> = {
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
          tileZ: req.tileZ ?? 0,
          keyframe: req.keyframe
        })
        .then((metadata) => VoxelContent.fromMetadataArray([metadata]))
    }
  }
  if (options.keyframeCount && options.timeIntervalCollection) {
    provider.keyframeCount = options.keyframeCount
    provider.timeIntervalCollection = options.timeIntervalCollection
  }
  return provider as unknown as VoxelProvider
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

/**
 * PM2.5 体着色器：VEC4 元数据 .r=浓度、.g=有效掩膜、.b=浓度梯度、.a=置信度。
 * 在传递函数的基础上：
 *   - 梯度边界增强：烟羽锋面/污染边界处提高不透明度，让高浓度核心与边界更清晰；
 *   - 置信度调制：边界层以上/远离污染源的低置信度体元素适度减淡，避免伪影；
 *   - 高浓度核心轻微提亮，强化污染中心的空间识别。
 */
export function createPm25Shader(initialLut: Uint8Array): CustomShader {
  return new CustomShader({
    uniforms: {
      uTransferFunction: { type: UniformType.SAMPLER_2D, value: makeLutTexture(initialLut) },
      uValueMin: { type: UniformType.FLOAT, value: 0 },
      uValueMax: { type: UniformType.FLOAT, value: 1 },
      uOpacity: { type: UniformType.FLOAT, value: 0.72 },
      uLighting: { type: UniformType.FLOAT, value: 0.4 },
      uDensityGamma: { type: UniformType.FLOAT, value: 1.25 },
      uThresholdSoft: { type: UniformType.FLOAT, value: 0.0 },
      /** 梯度边界增强强度 */
      uEdgeGain: { type: UniformType.FLOAT, value: 0.55 },
      /** 低置信度处保留的最低不透明度比例 */
      uConfidenceFloor: { type: UniformType.FLOAT, value: 0.35 },
      /** Beer-Lambert 消光系数：越大高密度核心越致密 */
      uExtinction: { type: UniformType.FLOAT, value: 2.2 }
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec4 meta = fsInput.metadata.color;
        float value = meta.r;
        float valid = meta.g;
        float grad = clamp(meta.b, 0.0, 1.0);
        float confidence = clamp(meta.a, 0.0, 1.0);
        vec3 color = vec3(0.0);
        float alpha = 0.0;
        if (valid > 0.5) {
          float t = clamp((value - uValueMin) / max(0.000001, uValueMax - uValueMin), 0.0, 1.0);
          vec4 c = texture(uTransferFunction, vec2(t, 0.5));
          // 传递函数 alpha 视为光学密度，按 Beer-Lambert 1-exp(-ρσ) 转为消光，
          // 低浓度近乎透明、高浓度密度饱和，避免线性映射造成的体块感。
          float density = pow(clamp(c.a, 0.0, 1.0), max(0.05, uDensityGamma));
          float extinction = 1.0 - exp(-density * max(0.0, uExtinction));
          float gate = uThresholdSoft > 0.0001 ? smoothstep(0.0, uThresholdSoft, t) : 1.0;
          float edge = 1.0 + uEdgeGain * smoothstep(0.05, 0.65, grad);
          color = min(vec3(1.0), c.rgb * (1.0 + 0.22 * smoothstep(0.4, 1.0, t)));
          alpha = uOpacity * extinction * gate * mix(uConfidenceFloor, 1.0, confidence) * edge;
        }
        ${SHADING}
        material.diffuse = color * shade;
        material.alpha = clamp(alpha, 0.0, 1.0);
      }
    `
  })
}

/**
 * 地下水污染羽流着色器：VEC4 元数据 .r=浓度、.g=有效掩膜、.b=污染体密度、.a=数据质量/赋存适宜度。
 * 在风险传递函数基础上：
 *   - 按密度（.b）执行 Beer-Lambert 消光，高浓度核心致密、低浓度近乎透明；
 *   - 按质量（.a）调制置信度，弱透水层与远场低置信度适度减淡；
 *   - 低于风险阈值的达标区保持透明，突出污染羽边界；
 *   - 高浓度核心轻微提亮，强化污染中心的空间识别。
 */
export function createPlumeShader(initialLut: Uint8Array, riskThreshold = 0): CustomShader {
  return new CustomShader({
    uniforms: {
      uTransferFunction: { type: UniformType.SAMPLER_2D, value: makeLutTexture(initialLut) },
      uValueMin: { type: UniformType.FLOAT, value: 0 },
      uValueMax: { type: UniformType.FLOAT, value: 1 },
      uOpacity: { type: UniformType.FLOAT, value: 0.9 },
      uLighting: { type: UniformType.FLOAT, value: 0.42 },
      uDensityGamma: { type: UniformType.FLOAT, value: 1.1 },
      /** 风险边界阈值（归一化 0~1）：低于此浓度视为达标、近乎透明 */
      uRiskThreshold: { type: UniformType.FLOAT, value: Math.max(0, Math.min(1, riskThreshold)) },
      /** 风险边界软过渡宽度 */
      uRiskSoft: { type: UniformType.FLOAT, value: 0.06 },
      /** 污染体密度增强系数 */
      uDensityGain: { type: UniformType.FLOAT, value: 1.35 },
      /** 低置信度处保留的最低不透明度比例 */
      uQualityFloor: { type: UniformType.FLOAT, value: 0.3 },
      /** Beer-Lambert 消光系数 */
      uExtinction: { type: UniformType.FLOAT, value: 2.6 }
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec4 meta = fsInput.metadata.color;
        float value = meta.r;
        float valid = meta.g;
        float density = clamp(meta.b, 0.0, 1.0);
        float quality = clamp(meta.a, 0.0, 1.0);
        vec3 color = vec3(0.0);
        float alpha = 0.0;
        if (valid > 0.5) {
          float t = clamp((value - uValueMin) / max(0.000001, uValueMax - uValueMin), 0.0, 1.0);
          vec4 c = texture(uTransferFunction, vec2(t, 0.5));
          float gate = smoothstep(uRiskThreshold, uRiskThreshold + max(0.0001, uRiskSoft), t);
          float dens = pow(clamp(density * uDensityGain, 0.0, 1.0), max(0.05, uDensityGamma));
          float extinction = 1.0 - exp(-dens * max(0.0, uExtinction));
          float q = mix(uQualityFloor, 1.0, quality);
          color = min(vec3(1.0), c.rgb * (1.0 + 0.28 * smoothstep(0.55, 1.0, t)));
          alpha = uOpacity * extinction * gate * q;
        }
        ${SHADING}
        material.diffuse = color * shade;
        material.alpha = clamp(alpha, 0.0, 1.0);
      }
    `
  })
}

/**
 * 火灾体着色器：VEC4 元数据 .r=温度归一化、.g=烟气归一化、.b=湍流细节、.a=有效掩膜。
 * 在同一体数据上以 uMode 切换四种态势表达，无需重建瓦片：
 *   0 复合态势：低温烟气按 Beer-Lambert 消光呈灰黑、高温核心自发光；
 *   1 温度场：热力传递函数 + 高温自发光提亮；
 *   2 烟气浓度：烟气传递函数 + 消光致密化；
 *   3 风险分级：按温度/烟气危险阈值取复合风险等级着色。
 */
export function createFireShader(options: {
  temperatureLut: Uint8Array
  smokeLut: Uint8Array
  riskColors: [number, number, number][]
}): CustomShader {
  const risk = options.riskColors
  const rc = (i: number): [number, number, number] => risk[i] ?? risk[risk.length - 1] ?? [1, 1, 1]
  const rcv = (i: number): Cartesian3 => {
    const c = rc(i)
    return new Cartesian3(c[0], c[1], c[2])
  }
  return new CustomShader({
    uniforms: {
      uTemperatureLut: { type: UniformType.SAMPLER_2D, value: makeLutTexture(options.temperatureLut) },
      uSmokeLut: { type: UniformType.SAMPLER_2D, value: makeLutTexture(options.smokeLut) },
      uMode: { type: UniformType.FLOAT, value: 0 },
      uOpacity: { type: UniformType.FLOAT, value: 0.62 },
      uLighting: { type: UniformType.FLOAT, value: 0.35 },
      /** 烟气 Beer-Lambert 消光系数 */
      uSmokeExtinction: { type: UniformType.FLOAT, value: 2.8 },
      uSmokeGamma: { type: UniformType.FLOAT, value: 1.1 },
      /** 高温核心自发光强度 */
      uTempEmission: { type: UniformType.FLOAT, value: 0.85 },
      /** 温度危险阈值（归一化 0~1） */
      uRt0: { type: UniformType.FLOAT, value: (60 - 20) / 880 },
      uRt1: { type: UniformType.FLOAT, value: (150 - 20) / 880 },
      uRt2: { type: UniformType.FLOAT, value: (350 - 20) / 880 },
      uRt3: { type: UniformType.FLOAT, value: (600 - 20) / 880 },
      /** 烟气危险阈值（归一化 0~1） */
      uRs0: { type: UniformType.FLOAT, value: 50 / 400 },
      uRs1: { type: UniformType.FLOAT, value: 150 / 400 },
      uRs2: { type: UniformType.FLOAT, value: 250 / 400 },
      uRs3: { type: UniformType.FLOAT, value: 400 / 400 },
      uRisk0: { type: UniformType.VEC3, value: rcv(0) },
      uRisk1: { type: UniformType.VEC3, value: rcv(1) },
      uRisk2: { type: UniformType.VEC3, value: rcv(2) },
      uRisk3: { type: UniformType.VEC3, value: rcv(3) },
      uRisk4: { type: UniformType.VEC3, value: rcv(4) }
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec4 meta = fsInput.metadata.color;
        float temp = clamp(meta.r, 0.0, 1.0);
        float smoke = clamp(meta.g, 0.0, 1.0);
        float turb = clamp(meta.b, 0.0, 1.0);
        float valid = meta.a;
        vec3 color = vec3(0.0);
        float alpha = 0.0;
        if (valid > 0.01) {
          float ext = 1.0 - exp(-pow(smoke, max(0.05, uSmokeGamma)) * uSmokeExtinction);
          float hot = smoothstep(0.05, 0.8, temp);
          if (uMode < 0.5) {
            // 复合态势：烟气越浓越黑，高温核心偏红黄并自发光
            vec3 smokeCol = mix(vec3(0.5, 0.49, 0.47), vec3(0.05, 0.045, 0.05), smoothstep(0.15, 0.85, smoke));
            vec3 fireCol = mix(vec3(0.86, 0.2, 0.03), vec3(1.0, 0.88, 0.45), smoothstep(0.0, 0.55, hot));
            color = mix(smokeCol, fireCol, hot);
            color *= (0.72 + 0.5 * turb);
            alpha = uOpacity * (ext * (0.65 + 0.55 * turb) * (1.0 - 0.6 * hot) + hot * uTempEmission);
          } else if (uMode < 1.5) {
            // 温度场
            vec4 c = texture(uTemperatureLut, vec2(temp, 0.5));
            color = min(vec3(1.5), c.rgb * (1.0 + 0.5 * hot));
            alpha = uOpacity * clamp(c.a, 0.0, 1.0) * smoothstep(0.0, 0.22, temp) * (0.8 + 0.4 * turb);
          } else if (uMode < 2.5) {
            // 烟气浓度
            vec4 c = texture(uSmokeLut, vec2(smoke, 0.5));
            color = c.rgb;
            alpha = uOpacity * ext * (0.68 + 0.55 * turb);
          } else {
            // 风险分级：温度/烟气各自分级取较大者
            float tb = step(uRt0, temp) + step(uRt1, temp) + step(uRt2, temp) + step(uRt3, temp);
            float sb = step(uRs0, smoke) + step(uRs1, smoke) + step(uRs2, smoke) + step(uRs3, smoke);
            float band = max(tb, sb);
            vec3 rc = uRisk0;
            if (band > 3.5) rc = uRisk4;
            else if (band > 2.5) rc = uRisk3;
            else if (band > 1.5) rc = uRisk2;
            else if (band > 0.5) rc = uRisk1;
            float sev = band / 4.0;
            color = rc;
            alpha = uOpacity * smoothstep(0.0, 0.3, max(temp, smoke)) * (0.45 + 0.55 * sev) * (0.8 + 0.4 * turb);
          }
        }
        ${SHADING}
        material.diffuse = color * shade;
        material.alpha = clamp(alpha, 0.0, 1.0);
      }
    `
  })
}

/** 火灾风险分级色（安全→极高危），供风险 LUT 纹理与 UI 图例共用 */
export function fireRiskLut(colors: [number, number, number][]): Uint8Array {
  const lut = new Uint8Array(LUT_WIDTH * 4)
  const bands = colors.length || 1
  for (let i = 0; i < LUT_WIDTH; i += 1) {
    const t = i / (LUT_WIDTH - 1)
    const seg = Math.min(bands - 1, Math.floor(t * bands))
    const c = colors[seg] ?? [120, 120, 120]
    lut[i * 4] = c[0]
    lut[i * 4 + 1] = c[1]
    lut[i * 4 + 2] = c[2]
    lut[i * 4 + 3] = 255
  }
  return lut
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
