import { Cartesian2, Cartesian4, JulianDate } from "cesium";

/** 内置默认预设（与 demo-official.js 使用的默认效果一致）。 */
export const DEFAULT_OPTIONS = {
  /** 是否在初始化后启用天空效果；false 保留配置但暂停效果渲染。 */
  enabled: true,
  /** 云量覆盖度 [0,1]；越大云区越广，≤0.1 基本无云，独立于云体密度。 */
  coverage: 0.34,
  /** 天气纹理移动速度 [x,y]（纹理坐标/秒）；绝对值越大移动越快，0 停止，负值反向。 */
  localWeatherVelocity: [0.0003, 0.0001],
  /** HDR 色调映射曲线：7=AgX、8=Neutral、9=ACES、10=Linear、11=Reinhard、12=Cineon。 */
  toneMappingMode: 9,
  /** 色调映射前的亮度倍率（无量纲，建议 ≥0）；越大越亮，单位不是曝光档位 EV。 */
  toneMappingExposure: 2.8,
  /** 地表光照增益（非负倍率）；越大地表越亮，独立于云体补光，仍受色调映射影响。 */
  irradianceScale: 0.15,
  /** 地表大气透视混合强度 [0,1]；越大远景雾感越强，0 关闭此混合，不改变天空和云的散射。 */
  aerialPerspectiveStrength: 0.15,
  /** 夜间天空辉光的调制系数（无量纲，建议 [0,1]）；作用于 _customDarkParam.y，白天通常不明显。 */
  nightGlowIntensity: 0.5,
  /** 太阳泛光/光晕强度（无量纲，建议 ≥0）；越大亮部扩散越明显，0 关闭此强度。 */
  bloomIntensity: 0.002,
  /** 独立体积光配置；与旧 cloud.haze* 路径按 mode 互斥渲染。 */
  volumetricLight: {
    /** 体积光模式：volumetric 使用独立体积雾，legacy 保留旧 haze，off 关闭两条额外体积光路径。 */
    mode: "volumetric",
    /** 介质消光密度（非负，米的倒数）；越大散射和遮蔽越强，0 不产生体积光介质。 */
    density: 0.000008,
    /** 散射亮度倍率（非负）；不改变介质密度与消光，0 移除散射亮度。 */
    intensity: 2,
    /** 云底向下的体积层厚度（正有限米数）；越大参与散射的垂直范围越厚。 */
    layerDepth: 2400,
    /** 体积光沿视线的最大积分距离（正有限米数）；还受场景深度和云前缘限制。 */
    maxDistance: 16000,
    /** 前向散射偏好 g [0,0.9]；0 为各向同性，越大越集中于朝太阳的观察方向。 */
    anisotropy: 0.55,
    /** 分辨率比例/积分步数/可见性图尺寸：low=0.25/24/512，balanced=0.5/48/1024，high=0.5/64/2048。 */
    quality: "balanced",
  },
  /** 云层形态、照明、穿云光介质与降噪配置；初始化时可只覆盖其中的部分字段。 */
  cloud: {
    /** 按相机椭球高度淡出云量 [开始高度,消失高度]（米，0 ≤ 开始 < 消失）；null 禁用。 */
    altitudeFadeRange: [30000, 90000],
    /** 三层云型依次为积云/高积云/卷云；支持 cumulus、altocumulus、cirrus，null 恢复原有云形。 */
    layerTypes: ["cumulus", "altocumulus", "cirrus"],
    /** 按距相机距离降低采样细节 [近距离阈值,远距离阈值]（米，0 ≤ 近 < 远）；null 关闭 LOD。 */
    lodRange: [200000, 500000],
    /** 云底高度 [第一层,第二层,第三层,预留]（米），接受数组或 Cartesian4；以渲染行星高度为基准。 */
    altitudes: [4000, 6000, 10000, 0],
    /** 云层厚度 [第一层,第二层,第三层,预留]（米），接受数组或 Cartesian4；云顶 = 云底 + 厚度。 */
    heights: [1300, 1800, 650, 0],
    /** 云密度倍率 [第一层,第二层,第三层,预留]（无量纲，建议 ≥0），接受数组或 Cartesian4；0 关闭对应层介质。 */
    densityScales: [0.12, 0.09, 0.0015, 0],
    /** 云形细节侵蚀 [第一层,第二层,第三层,预留]（各分量 [0,1]），接受数组或 Cartesian4；越大边缘越破碎。 */
    shapeDetailAmounts: [0.18, 0.12, 0, 0],
    /** 天空辐照度对云体的补光倍率（非负）；越大云暗面越亮，0 移除这一补光项。 */
    skyIrradianceScale: 1.8,
    /** 地面反射辐照度对云体的补光倍率（非负）；越大云下部越亮，独立于地表增益 irradianceScale。 */
    groundIrradianceScale: 1.3,
    /** 穿云光 haze 介质密度缩放（非负）；越大散射和消光越强，0 关闭额外穿云光，建议小于 0.0001。 */
    hazeDensityScale: 0.08 * 0.0001,
    /** true 在参与云影投射的云底附近积分世界固定薄层，可独立开启近地雾；false 使用行星表面以上的指数高度雾。 */
    hazeCloudAttached: true,
    /** 局部模式的近地薄雾密度倍率 [0,1]；0 仅保留云底薄层，1 恢复完整近地层，不影响传统高度雾。 */
    hazeGroundDensityScale: 0,
    /** 局部薄层模式的最大观察距离（正有限米数）；只限制候选薄层的可见距离，空路不产生介质。 */
    hazeViewDistance: 16000,
    /** 局部薄层模式沿视线累计的散射区间长度上限（正有限米数）；按近到远累积，空路不计入长度。 */
    hazeVolumeLength: 1200,
    /** haze 太阳直射散射增益（非负倍率）；0 移除此直射项，不改变介质消光、云体照明或天空补光。 */
    hazeDirectLightScale: 8,
    /** haze 积分预算：low=16 点/每点 1 次云影读取，balanced=24/2，high=32/4；越高越细腻但更耗 GPU。 */
    hazeQuality: "high",
    /** haze 垂直密度衰减尺度（正有限米数）；传统模式在此高度降至 1/e，局部模式用于限制薄层厚度。 */
    hazeHeightFalloff: 1200,
    /** haze 前向散射偏好 g [0,0.9]；0 为各向同性，越大越集中于朝太阳的观察方向。 */
    hazeAnisotropy: 0.55,
    /** 大气阴影长度积分上限（正有限米数）；传统模式同时限制 haze 光路，局部模式改用上方两个距离参数。 */
    maxShadowLengthRayDistance: 6000,
    /** haze 日光的线性 RGB 倍率 [r,g,b]（非负，可大于 1）；不是 0–255 的 sRGB 值，不改变云本身的颜色。 */
    hazeSunColor: [1, 0.78, 0.42],
    /** 云的时域积累与空间重建配置；平衡静止时的稳定性、运动拖影和细节保留。 */
    denoise: {
      /** 普通时域积累的当前帧权重 [0,1]；越小越依赖历史、降噪越强，但可能拖影。 */
      temporalAlpha: 0.04,
      /** 时域升采样中本帧采样相位的当前帧权重 [0,1]；越大新采样越快生效，但更易暴露噪声。 */
      currentFrameAlpha: 0.08,
      /** 相机运动时的当前帧权重下限 [0,1]；越大拖影越少但噪声越明显，0 保持普通降噪权重。 */
      motionAlpha: 0.25,
      /** 历史颜色方差裁剪的标准差倍率（正有限数）；越大保留历史越宽松，越小越严格排除旧色。 */
      varianceGamma: 2,
      /** 深度/透明度感知的邻域重建混合强度 [0,1]；越大越平滑但细节更少，0 关闭此邻域平滑。 */
      spatialFilterStrength: 0.8,
    },
  },
  /**
   * 太阳光来源：
   *   true  —— 跟随 Cesium 实际太阳（由 viewer.clock 时间决定，推荐）。
   *   false —— 使用 pass 内置的自定义太阳方向（需自行写入 uniformState.sunDirectionWC2）。
   * 此开关只决定光源方向的来源，不调节光照强度。
   */
  systemLight: true,
  /** 初始化时是否统一设置 HDR、对数深度、gamma 和地形深度测试；false 由调用方自行配置场景。 */
  applySceneSettings: true,
  /** 场景 HDR 开关；true 保留更宽的亮度范围供色调映射使用，初始化时受 applySceneSettings 控制。 */
  highDynamicRange: true,
  /** 场景对数深度缓冲开关；改善远近同框时的深度精度，初始化时受 applySceneSettings 控制。 */
  logarithmicDepthBuffer: true,
  /** 场景显示 Gamma（正数）；一般增大会提亮中间调，初始化时受 applySceneSettings 控制。 */
  gamma: 2.2,
  /**
   * HBAO 屏幕空间环境光遮蔽（增强建筑/地形接触阴影与立体感，纯深度实现）。
   * 通过 enabled 关闭或启用，并使用完整对象保存数值：
   * { enabled, intensity, maxRadius, bias, frustumLength, blackPoint, whitePoint, gamma, denoise }
   */
  hbao: {
    /** 是否启用 HBAO；关闭时保留全部数值配置。 */
    enabled: true,
    /** AO 强度指数（建议 ≥0）；越大接触遮蔽越暗，0 不产生 AO 对比。 */
    intensity: 100,
    /** 视空间遮蔽邻域的最大半径（米）；越大影响范围越广，过大可能产生暗边或跨物体污染。 */
    maxRadius: 30,
    /** 遮蔽切线的角度偏移（弧度）；增大可减少自遮蔽伪影，但会弱化细小接触阴影。 */
    bias: 0.1,
    /** AO 处理的相机视空间深度上限（米）；超过此距离的远景跳过遮蔽计算。 */
    frustumLength: 100000,
    /** AO 调制颜色曲线的输入黑点（建议 [0,1)）；越大暗部截断越多，不能设为 1。 */
    blackPoint: 0.05,
    /** AO 调制颜色曲线的输出亮度倍率（建议 [0,1]）；越大被遮蔽部分越亮，0 为黑色。 */
    whitePoint: 0.9,
    /** AO 调制曲线的幂指数（正数）；越大中间亮度越暗，独立于场景 gamma 和降噪 varianceGamma。 */
    gamma: 2.5,
    /** HBAO 双边滤波降噪开关；仅构造时设置。 */
    denoise: true,
  },
  /**
   * SMAA 亚像素形态学抗锯齿（比 FXAA 更锐利、无明显模糊，纯屏幕空间）。
   * 作用于天空效果合成后的最终图像。false 关闭；true 启用，不替代云体时域降噪。
   */
  smaa: true,
  /** 地表积雪开关；开启后加载雪纹理。 */
  snow: false,
  /** 雨效开关，包含场景闪光及屏幕雨纹。 */
  rain: false,
  /**
   * Viewer 时钟时间（ISO8601 字符串，Z 表示 UTC）；systemLight=true 时用于决定太阳角度。
   * 显式传 undefined 或 null 可保留用户时钟；仅传 Scene 时不会设置时钟。
   */
  time: "2026-05-01T06:00Z",
};

const CLOUD_LAYER_TYPES = ["cumulus", "altocumulus", "cirrus"];
const QUALITY_LEVELS = ["low", "balanced", "high"];
const HBAO_KEYS = Object.keys(DEFAULT_OPTIONS.hbao);

export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/** Arrays and vector inputs are copied so caller-owned values never enter saved state. */
export function cloneOptions(value) {
  if (value instanceof Cartesian2) return [value.x, value.y];
  if (value instanceof Cartesian4) return [value.x, value.y, value.z, value.w];
  if (Array.isArray(value)) return value.map(cloneOptions);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneOptions(item)]));
  return value;
}

export function mergeOptions(base, patch) {
  const result = cloneOptions(base);
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isPlainObject(value) && isPlainObject(base[key])
      ? mergeOptions(base[key], value) : cloneOptions(value);
  }
  return result;
}

function assertObject(value, path) {
  if (!isPlainObject(value)) throw new Error(`[SkyAtmos] ${path} 必须是参数对象。`);
}

function assertKeys(value, allowedKeys, path) {
  assertObject(value, path);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) throw new Error(`[SkyAtmos] 未知配置字段：${path ? `${path}.` : ""}${key}。`);
  }
}

function number(value, path, minimum = -Infinity, maximum = Infinity, exclusiveMinimum = false, exclusiveMaximum = false) {
  if (!Number.isFinite(value) || (exclusiveMinimum ? value <= minimum : value < minimum) || (exclusiveMaximum ? value >= maximum : value > maximum)) {
    throw new Error(`[SkyAtmos] ${path} 必须是合法范围内的有限数字（${exclusiveMinimum ? ">" : "≥"}${minimum}，${exclusiveMaximum ? "<" : "≤"}${maximum}）。`);
  }
}

function boolean(value, path) {
  if (typeof value !== "boolean") throw new Error(`[SkyAtmos] ${path} 必须是布尔值。`);
}

function enumeration(value, path, choices) {
  if (!choices.includes(value)) throw new Error(`[SkyAtmos] ${path} 必须是 ${choices.join("、")}。`);
}

function vector(value, path, count, minimum = -Infinity, maximum = Infinity) {
  if (!Array.isArray(value) || value.length !== count) throw new Error(`[SkyAtmos] ${path} 必须含 ${count} 个有限数字。`);
  for (let index = 0; index < count; index++) number(value[index], `${path}[${index}]`, minimum, maximum);
}

function range(value, path) {
  if (value === null) return;
  vector(value, path, 2, 0);
  if (value[1] <= value[0]) throw new Error(`[SkyAtmos] ${path} 的结束值必须大于开始值。`);
}

function validateCloud(cloud) {
  assertKeys(cloud, Object.keys(DEFAULT_OPTIONS.cloud), "cloud");
  for (const [key, value] of Object.entries(cloud)) {
    const path = `cloud.${key}`;
    if (["altitudeFadeRange", "lodRange"].includes(key)) range(value, path);
    else if (key === "layerTypes") {
      if (value !== null) {
        if (!Array.isArray(value) || value.length !== 3) throw new Error(`[SkyAtmos] ${path} 必须是三个云型，或 null。`);
        for (const type of value) enumeration(type, path, CLOUD_LAYER_TYPES);
      }
    } else if (key === "altitudes") vector(value, path, 4);
    else if (["heights", "densityScales"].includes(key)) vector(value, path, 4, 0);
    else if (key === "shapeDetailAmounts") vector(value, path, 4, 0, 1);
    else if (key === "hazeSunColor") vector(value, path, 3, 0);
    else if (key === "hazeCloudAttached") boolean(value, path);
    else if (key === "hazeQuality") enumeration(value, path, QUALITY_LEVELS);
    else if (key === "hazeGroundDensityScale") number(value, path, 0, 1);
    else if (key === "hazeAnisotropy") number(value, path, 0, 0.9);
    else if (["hazeViewDistance", "hazeVolumeLength", "hazeHeightFalloff", "maxShadowLengthRayDistance"].includes(key)) number(value, path, 0, Infinity, true);
    else if (key === "denoise") {
      assertKeys(value, Object.keys(DEFAULT_OPTIONS.cloud.denoise), path);
      for (const [denoiseKey, denoiseValue] of Object.entries(value)) {
        number(denoiseValue, `${path}.${denoiseKey}`, 0, denoiseKey === "varianceGamma" ? Infinity : 1, denoiseKey === "varianceGamma");
      }
    } else number(value, path, 0);
  }
}

function validateVolumetricLight(options) {
  assertKeys(options, Object.keys(DEFAULT_OPTIONS.volumetricLight), "volumetricLight");
  for (const [key, value] of Object.entries(options)) {
    const path = `volumetricLight.${key}`;
    if (key === "mode") enumeration(value, path, ["volumetric", "legacy", "off"]);
    else if (key === "quality") enumeration(value, path, QUALITY_LEVELS);
    else if (key === "anisotropy") number(value, path, 0, 0.9);
    else number(value, path, 0, Infinity, ["layerDepth", "maxDistance"].includes(key));
  }
}

function validateHbao(options) {
  assertKeys(options, HBAO_KEYS, "hbao");
  for (const [key, value] of Object.entries(options)) {
    const path = `hbao.${key}`;
    if (key === "enabled" || key === "denoise") boolean(value, path);
    else if (key === "blackPoint") number(value, path, 0, 1, false, true);
    else if (key === "whitePoint") number(value, path, 0);
    else if (key === "bias") number(value, path);
    else number(value, path, 0, Infinity, ["gamma", "frustumLength"].includes(key));
  }
}

/** Validate the whole command, including time, before a caller can commit any state. */
export function prepareOptions(input) {
  assertKeys(input, Object.keys(DEFAULT_OPTIONS), "");
  // Reject misspellings even when their supplied value happens to be undefined.
  if (isPlainObject(input.cloud)) {
    assertKeys(input.cloud, Object.keys(DEFAULT_OPTIONS.cloud), "cloud");
    if (isPlainObject(input.cloud.denoise)) assertKeys(input.cloud.denoise, Object.keys(DEFAULT_OPTIONS.cloud.denoise), "cloud.denoise");
  }
  if (isPlainObject(input.hbao)) assertKeys(input.hbao, HBAO_KEYS, "hbao");
  if (isPlainObject(input.volumetricLight)) assertKeys(input.volumetricLight, Object.keys(DEFAULT_OPTIONS.volumetricLight), "volumetricLight");
  const options = cloneOptions(input);
  // Undefined optional fields behave as omitted; time explicitly preserves the host clock.
  const removeUndefined = object => {
    for (const key of Object.keys(object)) {
      if (object[key] === undefined && !(object === options && key === "time")) delete object[key];
      else if (isPlainObject(object[key])) removeUndefined(object[key]);
    }
  };
  removeUndefined(options);
  let time;
  for (const [key, value] of Object.entries(options)) {
    if (["enabled", "systemLight", "applySceneSettings", "highDynamicRange", "logarithmicDepthBuffer", "smaa", "snow", "rain"].includes(key)) boolean(value, key);
    else if (["coverage", "aerialPerspectiveStrength"].includes(key)) number(value, key, 0, 1);
    else if (key === "nightGlowIntensity") number(value, key);
    else if (key === "toneMappingMode") enumeration(value, key, [2, 4, 7, 8, 9, 10, 11, 12]);
    else if (key === "gamma") number(value, key, 0, Infinity, true);
    else if (key === "localWeatherVelocity") vector(value, key, 2);
    else if (key === "cloud") validateCloud(value);
    else if (key === "volumetricLight") validateVolumetricLight(value);
    else if (key === "hbao") validateHbao(value);
    else if (key === "time") {
      if (value !== null && value !== undefined) {
        if (typeof value !== "string" || !value.length) throw new Error("[SkyAtmos] time 必须是 ISO 8601 字符串、null 或 undefined。");
        try { time = JulianDate.fromIso8601(value); }
        catch { throw new Error("[SkyAtmos] time 必须是有效的 ISO 8601 时间。"); }
      }
    } else number(value, key, 0);
  }
  return { options, time };
}

