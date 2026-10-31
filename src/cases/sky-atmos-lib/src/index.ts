import type { Cartesian2, Cartesian4, PostProcessStageComposite, Scene, Viewer } from 'cesium';
// 运行时由 JavaScript 实现提供，类型契约由本文件显式声明。
import { SkyAtmos as RuntimeSkyAtmos } from "../SkyAtmos.js";

/** 二维参数：数组依次为 [x, y]，也可传入 Cesium Cartesian2；单位由具体配置项定义。 */
export type SkyAtmosVector2 = readonly [number, number] | Cartesian2;
/** 三层云参数：[第一层, 第二层, 第三层, 预留]，也可传入 Cartesian4；第四分量约定为 0，不作必须等于 0 的校验。 */
export type SkyAtmosVector4 = readonly [number, number, number, number] | Cartesian4;
/** 采样质量档位：low 开销较低，balanced 折中，high 细节较好；具体预算见对应配置项。 */
export type SkyAtmosQuality = 'low' | 'balanced' | 'high';
/** 云型：cumulus 积云、altocumulus 高积云、cirrus 卷云；不改变云层高度或投影云层掩码。 */
export type SkyAtmosCloudType = 'cumulus' | 'altocumulus' | 'cirrus';
/**
 * HDR 色调映射曲线：2=Reinhard2、4=Uncharted2、7=AgX、8=Neutral、9=ACES、10=Linear、11=Reinhard、12=Cineon。
 * 历史模式 3 的亮度纹理路径尚未接入，不作为当前 SDK 支持的选项；默认仍为 9（ACES）。
 */
export type SkyAtmosToneMappingMode = 2 | 4 | 7 | 8 | 9 | 10 | 11 | 12;

/** 独立体积光配置；构造和 update() 均可只传需要覆盖的字段。 */
export interface SkyAtmosVolumetricLightOptions {
  /**
   * volumetric 使用独立体积光，legacy 使用 cloud.haze*，off 关闭两条额外体积光路径。
   * 只有显式修改 mode 才切换模式；修改 haze 参数不会自动切换，大气、云体光照和镜头光晕仍分别控制。
   * @default 'volumetric'
   */
  mode?: 'volumetric' | 'legacy' | 'off';
  /**
   * 介质消光密度，单位为米的倒数，必须是非负有限数；越大散射与遮蔽越强，0 移除此介质。
   * @default 0.000008
   */
  density?: number;
  /**
   * 散射亮度倍率，必须是非负有限数；0 移除散射亮度，仍保留介质消光。
   * @default 2
   */
  intensity?: number;
  /**
   * 最低有效投影云层云底向下延伸的体积层厚度，必须是正有限米数；底部最低到渲染行星表面。
   * @default 2400
   */
  layerDepth?: number;
  /**
   * 沿视线的最大观察/积分距离，必须是正有限米数；受场景深度与行星裁剪，同时决定聚焦云影接收范围。
   * @default 16000
   */
  maxDistance?: number;
  /**
   * 前向散射偏好 g，有限数 [0, 0.9]；0 为各向同性，越大越集中于朝太阳的观察方向。
   * @default 0.55
   */
  anisotropy?: number;
  /**
   * 宽高分辨率比例/积分步数/聚焦云影图边长：low=0.25/24/512，balanced=0.5/48/1024，high=0.5/64/2048。
   * 档位越高通常越耗 GPU；切换档位会重建对应渲染目标。
   * @default 'balanced'
   */
  quality?: SkyAtmosQuality;
}

/** 云体及 legacy haze 的时域积累与空间重建；不控制独立体积光的历史。 */
export interface SkyAtmosCloudDenoiseOptions {
  /**
   * 普通时域积累的当前帧基础权重 [0, 1]；越小越依赖历史，降噪更强但可能拖影。
   * @default 0.04
   */
  temporalAlpha?: number;
  /**
   * 时域升采样中本帧 Bayer 采样相位的当前帧基础权重 [0, 1]；越大新采样越快生效，也更易显露噪声。
   * @default 0.08
   */
  currentFrameAlpha?: number;
  /**
   * 相机运动时用于提高当前帧积累基值的权重 [0, 1]；越大通常拖影越少，最终权重仍会自适应调整。
   * @default 0.25
   */
  motionAlpha?: number;
  /**
   * 历史颜色方差裁剪的标准差倍率，必须为正有限数；越大允许保留的历史颜色范围越宽。
   * @default 2
   */
  varianceGamma?: number;
  /**
   * 深度/透明度感知的邻域重建混合强度 [0, 1]；越大越平滑，也会损失细节，0 关闭此邻域平滑。
   * @default 0.8
   */
  spatialFilterStrength?: number;
}

/**
 * 云层形态、照明、可见性和降噪配置；四分量参数按三层云及预留分量排列。
 * haze* 字段仅配置 legacy 模式的参数；需要使用时显式设置 volumetricLight.mode 为 legacy。
 */
export interface SkyAtmosCloudOptions {
  /**
   * 按相机椭球高度淡出云量：[开始高度, 消失高度]，单位米，0 ≤ 开始 < 消失；null 禁用。
   * 同时影响云影和相关光束可见性；不是云层自身的高度范围。
   * @default [30000, 90000]
   */
  altitudeFadeRange?: readonly [number, number] | null;
  /**
   * 三层云的云型，依次作用于第一、二、三层；null 使用通用噪声云形，不改变投影云层掩码。
   * @default ['cumulus', 'altocumulus', 'cirrus']
   */
  layerTypes?: readonly [SkyAtmosCloudType, SkyAtmosCloudType, SkyAtmosCloudType] | null;
  /**
   * 距相机的采样细节近/远阈值 [near, far]，单位米，0 ≤ near < far；null 关闭距离 LOD。
   * 调整采样细节，不改变云的位置，也不关闭相机高度淡出。
   * @default [200000, 500000]
   */
  lodRange?: readonly [number, number] | null;
  /**
   * 云底高度 [第一层, 第二层, 第三层, 预留]，单位米；以渲染行星表面为基准，不是距各处地形的离地高度。
   * @default [4000, 6000, 10000, 0]
   */
  altitudes?: SkyAtmosVector4;
  /**
   * 云层厚度 [第一层, 第二层, 第三层, 预留]，单位米；云顶高度 = 云底高度 + 厚度，第四项约定为 0。
   * @default [1300, 1800, 650, 0]
   */
  heights?: SkyAtmosVector4;
  /**
   * 云密度倍率 [第一层, 第二层, 第三层, 预留]，建议非负；0 移除对应层介质，与 coverage 云量分别控制。
   * @default [0.12, 0.09, 0.0015, 0]
   */
  densityScales?: SkyAtmosVector4;
  /**
   * 云形细节侵蚀 [第一层, 第二层, 第三层, 预留]，各分量为 [0, 1]；越大云边缘越破碎，第四项约定为 0。
   * @default [0.18, 0.12, 0, 0]
   */
  shapeDetailAmounts?: SkyAtmosVector4;
  /**
   * 天空辐照度对云体及 legacy haze 的补光倍率，非负；越大暗面越亮，独立体积光使用太阳直射光。
   * @default 1.8
   */
  skyIrradianceScale?: number;
  /**
   * 地面反射辐照度对云体的补光倍率，非负；越大云下部越亮，与地表 irradianceScale 分别控制。
   * @default 1.3
   */
  groundIrradianceScale?: number;
  /**
   * legacy haze 介质密度缩放，非负，建议小于 0.0001；越大散射与消光越强，0 移除额外 haze 贡献。
   * @default 0.000008
   */
  hazeDensityScale?: number;
  /**
   * legacy haze 的分布方式：true 在有效投影云层云底附近积分世界空间薄层，false 使用指数高度雾。
   * @default true
   */
  hazeCloudAttached?: boolean;
  /**
   * legacy 局部薄层模式的近地雾密度倍率 [0, 1]；0 仅保留云底薄层，1 恢复完整近地层，不影响指数高度雾。
   * @default 0
   */
  hazeGroundDensityScale?: number;
  /**
   * legacy 局部薄层模式的最大观察距离，必须是正有限米数；只限制薄层可见距离，空路不产生介质。
   * @default 16000
   */
  hazeViewDistance?: number;
  /**
   * legacy 局部薄层模式沿视线累计散射区间的长度上限，必须是正有限米数；按近到远累积，空隙不计入。
   * @default 1200
   */
  hazeVolumeLength?: number;
  /**
   * legacy haze 太阳直射散射增益，非负；0 移除此直射项，不改变介质消光、云体照明或天空补光。
   * @default 8
   */
  hazeDirectLightScale?: number;
  /**
   * legacy haze 积分点数/每点云影采样预算：low=16/1，balanced=24/2，high=32/4；更高预算增加 GPU 开销。
   * @default 'high'
   */
  hazeQuality?: SkyAtmosQuality;
  /**
   * legacy haze 垂直密度衰减尺度，必须是正有限米数；指数模式在此高度降至 1/e，局部模式用于薄层厚度控制。
   * @default 1200
   */
  hazeHeightFalloff?: number;
  /**
   * legacy haze 前向散射偏好 g，有限数 [0, 0.9]；0 为各向同性，越大越集中于朝太阳的观察方向。
   * @default 0.55
   */
  hazeAnisotropy?: number;
  /**
   * 大气阴影长度积分上限，必须是正有限米数；legacy 指数模式同时以此限制 haze 光路，局部模式使用其专用距离参数。
   * @default 6000
   */
  maxShadowLengthRayDistance?: number;
  /**
   * legacy haze 日光的三个非负线性 RGB 倍率 [r, g, b]，可大于 1；不是 0–255 的 sRGB 值，不改变云体颜色。
   * @default [1, 0.78, 0.42]
   */
  hazeSunColor?: readonly [number, number, number];
  /** 云体及 legacy haze 的降噪配置，可只覆盖部分字段；默认值见 SkyAtmosCloudDenoiseOptions。 */
  denoise?: SkyAtmosCloudDenoiseOptions;
}

/** 屏幕空间环境光遮蔽（HBAO）参数，用于增强建筑与地形接触阴影；各数值字段支持 update()。 */
export interface SkyAtmosHbaoOptions {
  /** 是否启用 HBAO；关闭时保留全部数值配置，修改数值不会隐式开启。
   * @default true
   */
  enabled?: boolean;
  /**
   * AO 强度指数，建议非负；越大接触遮蔽越深，0 不产生 AO 对比。
   * @default 100
   */
  intensity?: number;
  /**
   * 视空间遮蔽采样邻域的最大半径，单位米；越大影响范围越广，过大可能产生暗边。
   * @default 30
   */
  maxRadius?: number;
  /**
   * 遮蔽切线的角度偏移，单位弧度；增大可减少自遮蔽伪影，也会弱化细小接触阴影。
   * @default 0.1
   */
  bias?: number;
  /**
   * AO 处理的最大相机视空间深度，单位米；超过此深度的远景跳过遮蔽计算。
   * @default 100000
   */
  frustumLength?: number;
  /**
   * AO 调制曲线的输入黑点，建议 [0, 1)，不能设为 1；越大暗部截断越多。
   * @default 0.05
   */
  blackPoint?: number;
  /**
   * AO 调制曲线的输出亮度倍率，建议 [0, 1]；越大被遮蔽部分越亮，0 为黑色。
   * @default 0.9
   */
  whitePoint?: number;
  /**
   * AO 调制曲线的幂指数，正数；越大中间亮度越暗，与场景 gamma 和降噪 varianceGamma 分别控制。
   * @default 2.5
   */
  gamma?: number;
  /**
   * HBAO 双边滤波降噪开关；仅构造时生效，运行期更改会明确拒绝，需 dispose() 后重建，与云体降噪分别控制。
   * @default true
   */
  denoise?: boolean;
}

/** SkyAtmos 公开配置；构造时深合并默认预设，update() 时深合并已有配置，嵌套对象可只传部分字段。 */
export interface SkyAtmosOptions {
  /**
   * 是否启用天空效果；运行时切换同时控制已配置的 HBAO、SMAA 和体积光，false 保留配置并暂停效果渲染。
   * @default true
   */
  enabled?: boolean;
  /**
   * 天气云量覆盖度 [0, 1]，越大云区越广；与每层云密度分别控制，约 ≤0.1 时基本无云。
   * @default 0.34
   */
  coverage?: number;
  /**
   * 天气纹理 UV 每秒偏移量 [x, y]，也可传 Cartesian2；绝对值越大移动越快，0 停止，负值反向，不是米/秒。
   * @default [0.0003, 0.0001]
   */
  localWeatherVelocity?: SkyAtmosVector2;
  /**
   * HDR 色调映射曲线，数值含义见 SkyAtmosToneMappingMode；运行时切换会重建天空渲染阶段。
   * @default 9
   */
  toneMappingMode?: SkyAtmosToneMappingMode;
  /**
   * 色调映射前的亮度倍率，建议非负；越大越亮，单位不是曝光档位 EV。
   * @default 2.8
   */
  toneMappingExposure?: number;
  /**
   * 地表辐照度增益，非负倍率；越大地表越亮，与云体补光分别控制，仍受色调映射影响。
   * @default 0.15
   */
  irradianceScale?: number;
  /**
   * 地表大气透视混合强度 [0, 1]；越大远景雾感越强，0 关闭此混合，不改变天空和云的散射。
   * @default 0.15
   */
  aerialPerspectiveStrength?: number;
  /**
   * 夜间天空辉光调制系数，无量纲，建议 [0, 1]；白天通常不明显。
   * @default 0.5
   */
  nightGlowIntensity?: number;
  /**
   * 太阳泛光/光晕强度，无量纲，建议非负；越大亮部扩散越明显，0 移除此强度贡献。
   * @default 0.002
   */
  bloomIntensity?: number;
  /** 体积光模式及散射配置；与 legacy haze 路径互斥，默认使用 SkyAtmosVolumetricLightOptions 中的预设。 */
  volumetricLight?: SkyAtmosVolumetricLightOptions;
  /** 云层、可见性、照明、legacy haze 和降噪配置；各字段默认值见 SkyAtmosCloudOptions。 */
  cloud?: SkyAtmosCloudOptions;
  /**
   * true 跟随 Cesium 实际太阳方向（由场景时间决定）；false 仅让部分路径使用高级自定义太阳方向，云体与云影仍跟随 Cesium 太阳。
   * 此开关不调节光照强度，建议保持 true。
   * @default true
   */
  systemLight?: boolean;
  /**
   * 构造时是否设置 HDR、对数深度、gamma 和地形深度测试；false 由宿主自行配置。
   * 本配置持久保存，省略时保持原值；从 false 切为 true 时应用已保存的场景设置。
   * @default true
   */
  applySceneSettings?: boolean;
  /**
   * 场景 HDR 开关，true 保留更宽亮度范围供色调映射使用；受当前 applySceneSettings 配置控制。
   * @default true
   */
  highDynamicRange?: boolean;
  /**
   * 场景对数深度缓冲开关，用于改善远近同框时的深度精度；受当前 applySceneSettings 配置控制。
   * @default true
   */
  logarithmicDepthBuffer?: boolean;
  /**
   * 场景显示 Gamma，正数；通常增大会提亮中间调，与 HBAO gamma 分别控制，受当前 applySceneSettings 配置控制。
   * @default 2.2
   */
  gamma?: number;
  /**
   * HBAO 环境光遮蔽配置，可只提供需要覆盖的字段；通过 enabled 切换开关。
   * 关闭时仍保留全部数值，修改数值不会改变开关；默认值见 SkyAtmosHbaoOptions。
   */
  hbao?: SkyAtmosHbaoOptions;
  /**
   * 最终画面的 SMAA 抗锯齿开关；不替代云体时域降噪，可在运行时切换。
   * @default true
   */
  smaa?: boolean;
  /** 地表积雪开关；开启后加载雪纹理，默认为 false。
   * @default false
   */
  snow?: boolean;
  /** 雨效开关，包含场景闪光及屏幕雨条纹，默认为 false。
   * @default false
   */
  rain?: boolean;
  /**
   * Viewer 时钟时间，ISO 8601 字符串，Z 表示 UTC；systemLight=true 时影响太阳角度。
   * 构造时省略此字段会使用默认时间；显式传 null/undefined 保留宿主时间；仅传 Scene 时不设置时钟。
   * update() 省略此字段也保留宿主时间。
   * @default '2026-05-01T06:00Z'
   */
  time?: string | null | undefined;
}

/** 运行时局部更新配置；省略字段保持原值，数组整体替换，HBAO denoise 只能在构造时设置。 */
export type SkyAtmosUpdateOptions = Omit<SkyAtmosOptions, 'hbao'> & {
  /** 局部更新 HBAO 开关和数值；修改数值不隐式改变 enabled。 */
  hbao?: Omit<SkyAtmosHbaoOptions, 'denoise'>;
};

/** 完整的归一化云配置快照；所有字段存在，向量和范围均为可修改的独立数组。 */
export type SkyAtmosResolvedCloudOptions = Required<Omit<SkyAtmosCloudOptions,
  'altitudeFadeRange' | 'layerTypes' | 'lodRange' | 'altitudes' | 'heights' | 'densityScales' | 'shapeDetailAmounts' | 'hazeSunColor' | 'denoise'>> & {
  /** 相机高度淡出范围，null 表示关闭。 */
  altitudeFadeRange: [number, number] | null;
  /** 三层云型，null 表示通用噪声云形。 */
  layerTypes: [SkyAtmosCloudType, SkyAtmosCloudType, SkyAtmosCloudType] | null;
  /** 距离 LOD 近远阈值，null 表示关闭。 */
  lodRange: [number, number] | null;
  /** 三层云底高度及预留分量，单位米。 */
  altitudes: [number, number, number, number];
  /** 三层云厚度及预留分量，单位米。 */
  heights: [number, number, number, number];
  /** 三层云密度倍率及预留分量。 */
  densityScales: [number, number, number, number];
  /** 三层云细节侵蚀量及预留分量。 */
  shapeDetailAmounts: [number, number, number, number];
  /** legacy haze 日光的线性 RGB 倍率。 */
  hazeSunColor: [number, number, number];
  /** 完整的云体降噪配置。 */
  denoise: Required<SkyAtmosCloudDenoiseOptions>;
};

/** 已接受的完整配置快照；不表示宿主实时状态，所有嵌套对象和数组均为独立可修改副本。 */
export type SkyAtmosResolvedOptions = Required<Omit<SkyAtmosOptions,
  'localWeatherVelocity' | 'cloud' | 'volumetricLight' | 'hbao' | 'time'>> & {
  /** 天气纹理 UV 每秒偏移量，输出固定为数组。 */
  localWeatherVelocity: [number, number];
  /** 完整的归一化云配置。 */
  cloud: SkyAtmosResolvedCloudOptions;
  /** 完整的独立体积光配置。 */
  volumetricLight: Required<SkyAtmosVolumetricLightOptions>;
  /** 完整的 HBAO 配置，关闭时仍保留数值。 */
  hbao: Required<SkyAtmosHbaoOptions>;
  /** 最近接受的时钟配置；null 表示保留宿主时间，不表示当前实时钟值。 */
  time: string | null;
};

/** 当前配置所需资源的汇总状态；idle 表示尚未开始加载。 */
export type SkyAtmosAssetStatus = 'idle' | 'loading' | 'ready' | 'error' | 'disposed';

/** 单项效果资源错误，保留资源标识、URL 和原始失败原因。 */
export interface SkyAtmosAssetError {
  /** 资源的稳定标识。 */
  readonly id: string;
  /** 本轮加载使用的资源 URL。 */
  readonly url: string;
  /** 是否为当前加载范围所需资源。 */
  readonly required: boolean;
  /** 原始加载错误。 */
  readonly error: unknown;
}

/** 不可变资源状态快照，按当前配置汇总天空、开启的 SMAA 和雪纹理。 */
export interface SkyAtmosAssetState {
  /** 当前配置所需资源的汇总状态。 */
  readonly status: SkyAtmosAssetStatus;
  /** 当前范围内的冻结错误数组，关闭功能的历史错误不包含在内。 */
  readonly errors: readonly SkyAtmosAssetError[];
}

/**
 * 为 Cesium 三维透视地球场景添加天空效果，同页只允许一个活动实例，销毁后可重建。
 * 配置仅通过 update() 修改，读取配置和资源状态的方法没有副作用；销毁后仍可读取快照。
 */
export interface SkyAtmos {
  /** 已加入 scene.postProcessStages 的天空合成阶段，dispose() 后为 undefined；ready 仅表示 Cesium 阶段就绪。 */
  readonly stage: PostProcessStageComposite | undefined;
  /** 返回最近接受的完整归一化配置副本；修改它不会修改实例或默认预设。 */
  getOptions(): SkyAtmosResolvedOptions;
  /**
   * 局部更新配置；嵌套对象深合并，数组整体替换，省略字段保留已有配置。
   * @param options 本次需要覆盖的字段；非法输入会在提交前拒绝，修改模式必须显式指定 mode。
   * @throws 实例已销毁、场景不受支持、未知字段或配置不合法时抛出错误。
   */
  update(options?: SkyAtmosUpdateOptions): void;
  /** 纯查询当前配置所需资源的不可变状态快照，不启动资源请求。 */
  getAssetState(): SkyAtmosAssetState;
  /**
   * 启动并等待调用时配置所需的天空资源、开启的 SMAA 和雪纹理，即使总开关 enabled=false。
   * 后续配置变化由下次调用覆盖；目标资源失败以保留 URL 和原始原因的 AggregateError 拒绝。
   * 等待期间销毁或销毁后调用以 AbortError 拒绝；成功不等于 stage.ready。
   */
  loadAssets(): Promise<void>;
  /**
   * 启动当前配置范围中尚未请求的资源，并重试失败项；不重载成功项，等待范围内当前一轮加载结束。
   * 目标资源失败以 AggregateError 拒绝，等待期间销毁或销毁后调用以 AbortError 拒绝。
   */
  retryAssets(): Promise<void>;
  /**
   * 订阅当前配置所需资源的状态变化，返回取消订阅函数；初始状态通过 getAssetState() 查询。
   * @param listener 接收与 getAssetState() 同结构的不可变快照，监听器异常不会改变资源加载结果。
   * @throws 监听器不是函数时抛出错误；实例已销毁时返回空取消函数。
   */
  subscribeAssets(listener: (state: SkyAtmosAssetState) => void): () => void;
  /** 幂等移除每帧回调及自有后处理和 GPU 资源；须在销毁 Viewer 前调用，共享原始下载缓存继续保留。 */
  dispose(): void;
}

/** SkyAtmos 构造器，仅提供具名导出；支持 new、typeof SkyAtmos 和标准继承。 */
export interface SkyAtmosConstructor extends Function {
  /** 返回完整默认预设的独立副本，修改副本不会修改内置默认值。 */
  getDefaultOptions(): SkyAtmosResolvedOptions;
  /**
   * 创建 Viewer 前预下载八项必需 BIN/EXR/PNG 原始资源，无需 Viewer 或 GPU。
   * 同一 SDK 模块副本共享并发下载与缓存，60 秒无进展会中止；失败清除缓存并以含 URL 原因的 AggregateError 拒绝。
   * 再次调用只下载缺失资源；成功不代表实例已解码或上传 GPU，不包含雪纹理及 SMAA 查找纹理。
   */
  preloadAssets(): Promise<void>;
  /**
   * 创建效果并注册后处理及每帧更新，宿主需持续渲染以驱动动画。
   * @param viewerOrScene 已创建的 Cesium Viewer 或 Scene，仅传 Scene 时不设置 Viewer 时钟。
   * @param options 覆盖默认预设的部分配置；嵌套对象深合并、数组整体替换。
   * @throws 场景或浏览器能力不受支持、已有活动实例或配置不合法时抛出错误。
   */
  new (viewerOrScene: Viewer | Scene, options?: SkyAtmosOptions): SkyAtmos;
  /** JavaScript 实例原型，用于标准构造器反射，不作为改写入口。 */
  readonly prototype: SkyAtmos;
}

/** 公开类型由本文件定义，运行时由 JavaScript 实现提供。 */
export const SkyAtmos: SkyAtmosConstructor = RuntimeSkyAtmos as unknown as SkyAtmosConstructor;
