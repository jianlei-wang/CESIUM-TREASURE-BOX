/**
 * 三个案例的参数表：共享同一套天空管线，只暴露各自主题相关的参数。
 *
 * values 是面板直接编辑的扁平状态；applyPatch 把它翻译成 SkyAtmos.update() 的局部配置。
 */

const LAYER_TYPES = [
  { value: 'cumulus', label: '积云' },
  { value: 'altocumulus', label: '高积云' },
  { value: 'cirrus', label: '卷云' },
]

const HAZE_QUALITY = [
  { value: 'low', label: '低' },
  { value: 'balanced', label: '中' },
  { value: 'high', label: '高' },
]

const TONE_MAPPING = [
  { value: '7', label: 'AgX' },
  { value: '8', label: 'Neutral' },
  { value: '9', label: 'ACES' },
  { value: '10', label: 'Linear' },
  { value: '11', label: 'Reinhard' },
  { value: '12', label: 'Cineon' },
]

function rangeControl(key, label, min, max, step, extra = {}) {
  return { key, label, type: 'range', min, max, step, ...extra }
}

function toggleControl(key, label, extra = {}) {
  return { key, label, type: 'toggle', ...extra }
}

function selectControl(key, label, options, extra = {}) {
  return { key, label, type: 'select', options, ...extra }
}

function buildCloudsSchema(options) {
  const sections = [
    {
      title: '基础天气',
      controls: [
        toggleControl('enabled', '天空效果总开关'),
        rangeControl('coverage', '云量覆盖度', 0, 1, 0.01),
        rangeControl('windX', '风速 X', -0.005, 0.005, 0.00001),
        rangeControl('windY', '风速 Y', -0.005, 0.005, 0.00001),
      ],
    },
    {
      title: '云层形态',
      controls: [
        toggleControl('layerTypesEnabled', '启用分层云型'),
        ...[0, 1, 2].map((index) =>
          selectControl(`layerType${index}`, `第 ${index + 1} 层云型`, LAYER_TYPES, {
            disabled: (values) => !values.layerTypesEnabled,
          })
        ),
      ],
    },
    {
      title: '云层几何',
      controls: [0, 1, 2].flatMap((index) => [
        rangeControl(`altitude${index}`, `第 ${index + 1} 层云底`, 0, 20000, 1, { unit: 'm' }),
        rangeControl(`height${index}`, `第 ${index + 1} 层厚度`, 0, 10000, 1, { unit: 'm' }),
        rangeControl(`density${index}`, `第 ${index + 1} 层密度`, 0, index === 2 ? 0.05 : 1, index === 2 ? 0.0001 : 0.001),
        rangeControl(`detail${index}`, `第 ${index + 1} 层细节`, 0, 1, 0.01),
      ]),
    },
    {
      title: '云照明',
      controls: [
        rangeControl('skyIrradianceScale', '天空补光', 0, 5, 0.01),
        rangeControl('groundIrradianceScale', '地面反射补光', 0, 5, 0.01),
      ],
    },
  ]

  const values = {
    enabled: options.enabled,
    coverage: options.coverage,
    windX: options.localWeatherVelocity[0],
    windY: options.localWeatherVelocity[1],
    layerTypesEnabled: options.cloud.layerTypes !== null,
    altitude0: options.cloud.altitudes[0],
    altitude1: options.cloud.altitudes[1],
    altitude2: options.cloud.altitudes[2],
    height0: options.cloud.heights[0],
    height1: options.cloud.heights[1],
    height2: options.cloud.heights[2],
    density0: options.cloud.densityScales[0],
    density1: options.cloud.densityScales[1],
    density2: options.cloud.densityScales[2],
    detail0: options.cloud.shapeDetailAmounts[0],
    detail1: options.cloud.shapeDetailAmounts[1],
    detail2: options.cloud.shapeDetailAmounts[2],
    skyIrradianceScale: options.cloud.skyIrradianceScale,
    groundIrradianceScale: options.cloud.groundIrradianceScale,
  }
  for (let index = 0; index < 3; index += 1) {
    values[`layerType${index}`] = options.cloud.layerTypes?.[index] ?? 'cumulus'
  }

  const applyPatch = (values) => ({
    enabled: values.enabled,
    coverage: values.coverage,
    localWeatherVelocity: [values.windX, values.windY],
    cloud: {
      layerTypes: values.layerTypesEnabled
        ? [values.layerType0, values.layerType1, values.layerType2]
        : null,
      altitudes: [values.altitude0, values.altitude1, values.altitude2, 0],
      heights: [values.height0, values.height1, values.height2, 0],
      densityScales: [values.density0, values.density1, values.density2, 0],
      shapeDetailAmounts: [values.detail0, values.detail1, values.detail2, 0],
      skyIrradianceScale: values.skyIrradianceScale,
      groundIrradianceScale: values.groundIrradianceScale,
    },
  })

  return { sections, values, applyPatch }
}

function buildGodraySchema(options) {
  const hazeDensityToSlider = (value) => Number((value / 0.0001).toFixed(4))
  const isVolumetric = (values) => values.volumetricLightMode === 'volumetric'
  const isLegacy = (values) => values.volumetricLightMode === 'legacy'

  const sections = [
    {
      title: '体积光模式',
      controls: [
        selectControl('volumetricLightMode', '光路模式', [
          { value: 'volumetric', label: '独立体积光' },
          { value: 'legacy', label: '云底薄层光' },
          { value: 'off', label: '关闭' },
        ]),
      ],
    },
    {
      title: '独立体积光',
      controls: [
        rangeControl('volumetricDensity', '介质密度', 0, 0.0001, 0.000001, { visible: isVolumetric }),
        rangeControl('volumetricIntensity', '散射亮度', 0, 10, 0.1, { visible: isVolumetric }),
        rangeControl('volumetricLayerDepth', '云底层厚度', 1, 20000, 1, { unit: 'm', visible: isVolumetric }),
        rangeControl('volumetricMaxDistance', '最大积分距离', 1, 100000, 1, { unit: 'm', visible: isVolumetric }),
        rangeControl('volumetricAnisotropy', '散射方向性', 0, 0.9, 0.01, { visible: isVolumetric }),
        selectControl('volumetricQuality', '积分质量', HAZE_QUALITY, { visible: isVolumetric }),
      ],
    },
    {
      title: '云底薄层光',
      controls: [
        rangeControl('sunShaftsIntensity', '介质强度', 0, 1, 0.01, { visible: isLegacy }),
        toggleControl('hazeCloudAttached', '云底局部薄层', { visible: isLegacy }),
        rangeControl('hazeGroundDensityScale', '近地薄雾强度', 0, 1, 0.01, { visible: isLegacy }),
        rangeControl('hazeDirectLightScale', '日光直射增益', 0, 8, 0.1, { visible: isLegacy }),
        rangeControl('hazeViewDistance', '最大观察距离', 1, 100000, 1, { unit: 'm', visible: isLegacy }),
        rangeControl('hazeVolumeLength', '累计散射长度', 1, 20000, 1, { unit: 'm', visible: isLegacy }),
        rangeControl('hazeHeightFalloff', '高度衰减尺度', 1, 10000, 1, { unit: 'm', visible: isLegacy }),
        rangeControl('hazeAnisotropy', '散射方向性', 0, 0.9, 0.01, { visible: isLegacy }),
        selectControl('hazeQuality', '积分质量', HAZE_QUALITY, { visible: isLegacy }),
        rangeControl('hazeSunR', '日光 R', 0, 10, 0.01, { visible: isLegacy }),
        rangeControl('hazeSunG', '日光 G', 0, 10, 0.01, { visible: isLegacy }),
        rangeControl('hazeSunB', '日光 B', 0, 10, 0.01, { visible: isLegacy }),
      ],
    },
    {
      title: '太阳与时间',
      controls: [
        toggleControl('systemLight', '跟随系统太阳'),
        { key: 'time', label: 'UTC 时间', type: 'datetime' },
      ],
    },
  ]

  const values = {
    volumetricLightMode: options.volumetricLight.mode,
    volumetricDensity: options.volumetricLight.density,
    volumetricIntensity: options.volumetricLight.intensity,
    volumetricLayerDepth: options.volumetricLight.layerDepth,
    volumetricMaxDistance: options.volumetricLight.maxDistance,
    volumetricAnisotropy: options.volumetricLight.anisotropy,
    volumetricQuality: options.volumetricLight.quality,
    sunShaftsIntensity: hazeDensityToSlider(options.cloud.hazeDensityScale),
    hazeCloudAttached: options.cloud.hazeCloudAttached,
    hazeGroundDensityScale: options.cloud.hazeGroundDensityScale,
    hazeDirectLightScale: options.cloud.hazeDirectLightScale,
    hazeViewDistance: options.cloud.hazeViewDistance,
    hazeVolumeLength: options.cloud.hazeVolumeLength,
    hazeHeightFalloff: options.cloud.hazeHeightFalloff,
    hazeAnisotropy: options.cloud.hazeAnisotropy,
    hazeQuality: options.cloud.hazeQuality,
    hazeSunR: options.cloud.hazeSunColor[0],
    hazeSunG: options.cloud.hazeSunColor[1],
    hazeSunB: options.cloud.hazeSunColor[2],
    systemLight: options.systemLight,
    time: options.time ? options.time.slice(0, 16) : '2026-05-01T06:00',
  }

  const applyPatch = (values) => ({
    systemLight: values.systemLight,
    time: `${values.time}Z`,
    volumetricLight: {
      mode: values.volumetricLightMode,
      density: values.volumetricDensity,
      intensity: values.volumetricIntensity,
      layerDepth: values.volumetricLayerDepth,
      maxDistance: values.volumetricMaxDistance,
      anisotropy: values.volumetricAnisotropy,
      quality: values.volumetricQuality,
    },
    cloud: {
      hazeDensityScale: values.sunShaftsIntensity * 0.0001,
      hazeCloudAttached: values.hazeCloudAttached,
      hazeGroundDensityScale: values.hazeGroundDensityScale,
      hazeDirectLightScale: values.hazeDirectLightScale,
      hazeViewDistance: values.hazeViewDistance,
      hazeVolumeLength: values.hazeVolumeLength,
      hazeHeightFalloff: values.hazeHeightFalloff,
      hazeAnisotropy: values.hazeAnisotropy,
      hazeQuality: values.hazeQuality,
      hazeSunColor: [values.hazeSunR, values.hazeSunG, values.hazeSunB],
    },
  })

  return { sections, values, applyPatch }
}

function buildQualitySchema(options) {
  const sections = [
    {
      title: '色调映射',
      controls: [
        selectControl('toneMappingMode', '映射曲线', TONE_MAPPING),
        rangeControl('toneMappingExposure', '曝光', 0, 20, 0.1),
        rangeControl('irradianceScale', '地表光照增益', 0, 2, 0.01),
        rangeControl('aerialPerspectiveStrength', '地表大气透视', 0, 1, 0.01),
        rangeControl('nightGlowIntensity', '夜间辉光', 0, 1, 0.01),
        rangeControl('bloomIntensity', '太阳泛光', 0, 2, 0.001),
      ],
    },
    {
      title: '环境光遮蔽',
      controls: [
        toggleControl('hbaoEnabled', 'HBAO 开关'),
        rangeControl('hbaoIntensity', '强度', 0, 300, 1, { disabled: (values) => !values.hbaoEnabled }),
        rangeControl('hbaoMaxRadius', '最大半径', 1, 100, 1, { unit: 'm', disabled: (values) => !values.hbaoEnabled }),
        rangeControl('hbaoBias', '角度偏移', 0, 0.5, 0.01, { disabled: (values) => !values.hbaoEnabled }),
        rangeControl('hbaoFrustumLength', '处理深度上限', 1000, 1000000, 1000, {
          unit: 'm',
          disabled: (values) => !values.hbaoEnabled,
        }),
      ],
    },
    {
      title: '抗锯齿与场景',
      controls: [
        toggleControl('smaaEnabled', 'SMAA 抗锯齿'),
        toggleControl('highDynamicRange', '高动态范围'),
        toggleControl('logarithmicDepthBuffer', '对数深度缓冲'),
        rangeControl('gamma', '场景 Gamma', 0.1, 5, 0.1),
      ],
    },
    {
      title: '距离与高度',
      controls: [
        toggleControl('lodEnabled', '按距离降采样'),
        rangeControl('lodNear', '近距离阈值', 0, 1000000, 1000, {
          unit: 'm',
          disabled: (values) => !values.lodEnabled,
        }),
        rangeControl('lodFar', '远距离阈值', 0, 1000000, 1000, {
          unit: 'm',
          disabled: (values) => !values.lodEnabled,
        }),
        toggleControl('altitudeFadeEnabled', '按相机高度淡出'),
        rangeControl('altitudeFadeStart', '淡出起点', 0, 200000, 1000, {
          unit: 'm',
          disabled: (values) => !values.altitudeFadeEnabled,
        }),
        rangeControl('altitudeFadeEnd', '淡出终点', 0, 200000, 1000, {
          unit: 'm',
          disabled: (values) => !values.altitudeFadeEnabled,
        }),
        rangeControl('denoiseTemporalAlpha', '时域降噪权重', 0, 1, 0.01),
        rangeControl('denoiseMotionAlpha', '运动降噪权重', 0, 1, 0.01),
        rangeControl('denoiseSpatialFilterStrength', '空间滤波强度', 0, 1, 0.01),
      ],
    },
  ]

  const values = {
    toneMappingMode: String(options.toneMappingMode),
    toneMappingExposure: options.toneMappingExposure,
    irradianceScale: options.irradianceScale,
    aerialPerspectiveStrength: options.aerialPerspectiveStrength,
    nightGlowIntensity: options.nightGlowIntensity,
    bloomIntensity: options.bloomIntensity,
    hbaoEnabled: options.hbao.enabled,
    hbaoIntensity: options.hbao.intensity,
    hbaoMaxRadius: options.hbao.maxRadius,
    hbaoBias: options.hbao.bias,
    hbaoFrustumLength: options.hbao.frustumLength,
    smaaEnabled: options.smaa,
    highDynamicRange: options.highDynamicRange,
    logarithmicDepthBuffer: options.logarithmicDepthBuffer,
    gamma: options.gamma,
    lodEnabled: options.cloud.lodRange !== null,
    lodNear: options.cloud.lodRange?.[0] ?? 200000,
    lodFar: options.cloud.lodRange?.[1] ?? 500000,
    altitudeFadeEnabled: options.cloud.altitudeFadeRange !== null,
    altitudeFadeStart: options.cloud.altitudeFadeRange?.[0] ?? 30000,
    altitudeFadeEnd: options.cloud.altitudeFadeRange?.[1] ?? 90000,
    denoiseTemporalAlpha: options.cloud.denoise.temporalAlpha,
    denoiseMotionAlpha: options.cloud.denoise.motionAlpha,
    denoiseSpatialFilterStrength: options.cloud.denoise.spatialFilterStrength,
  }

  const applyPatch = (values) => ({
    toneMappingMode: Number(values.toneMappingMode),
    toneMappingExposure: values.toneMappingExposure,
    irradianceScale: values.irradianceScale,
    aerialPerspectiveStrength: values.aerialPerspectiveStrength,
    nightGlowIntensity: values.nightGlowIntensity,
    bloomIntensity: values.bloomIntensity,
    hbao: {
      enabled: values.hbaoEnabled,
      intensity: values.hbaoIntensity,
      maxRadius: values.hbaoMaxRadius,
      bias: values.hbaoBias,
      frustumLength: values.hbaoFrustumLength,
    },
    smaa: values.smaaEnabled,
    highDynamicRange: values.highDynamicRange,
    logarithmicDepthBuffer: values.logarithmicDepthBuffer,
    gamma: values.gamma,
    cloud: {
      lodRange: values.lodEnabled ? [values.lodNear, values.lodFar] : null,
      altitudeFadeRange: values.altitudeFadeEnabled
        ? [values.altitudeFadeStart, values.altitudeFadeEnd]
        : null,
      denoise: {
        temporalAlpha: values.denoiseTemporalAlpha,
        motionAlpha: values.denoiseMotionAlpha,
        spatialFilterStrength: values.denoiseSpatialFilterStrength,
      },
    },
  })

  return { sections, values, applyPatch }
}

const BUILDERS = {
  clouds: buildCloudsSchema,
  godray: buildGodraySchema,
  quality: buildQualitySchema,
}

export function buildSchema(preset, options) {
  const builder = BUILDERS[preset]
  if (!builder) throw new Error(`未知的天空案例预设：${preset}`)
  return builder(options)
}
