// qualityPresets.ts
//
// 体积云质量档位（spec：docs/superpowers/specs/2026-08-29-clouds-quality-presets-design.md §3/§4/§5）。
// 档位值逐字对齐 three-geospatial/packages/clouds/src/qualityPresets.ts:8-121
//（参考库在另一 repo 不可 import——对齐由 spec §3 表背书 + qualityPresets.test.ts 快照守「实现=spec 表」）。
// 未移植参考库字段（accuratePhaseFunction/haze/resolutionScale）不设；multiScatteringOctaves
// 恒 6 不进档位（参考库 TODO：降档会变暗需补偿，未解决——spec §3 末段）。
import { Cartesian2, Matrix4 } from 'cesium'
import {
  defaultCloudsParameters,
  type CloudsParameters,
  type CloudsShadowMarchParameters
} from './cloudsDefaultParameters'
import type { CloudsStageOptions } from './createCloudsStage'

export type CloudsQualityPreset = 'low' | 'medium' | 'high' | 'ultra'

/** 单档三路配置（spec §4）。params 仅列「与 defaults 不同或需投影」的字段——继承语义对齐
 *  参考库档位的 spread 展开_defaults。 */
export interface ResolvedCloudsQuality {
  /** 编译开关（CloudsMainOptions 对应字段）。 */
  main: { lightShafts: boolean; shapeDetail: boolean; turbulence: boolean; accurateSunSkyLight: boolean }
  /** uniform 覆盖（CloudsParameters 子集 + shadowCascadeCount 投影；不投影 shadowTexelSize——
   *  真消费点 frame state，spec §4 单一来源规则）。 */
  params: Partial<Pick<CloudsParameters,
    | 'maxIterationCount' | 'minStepSize' | 'maxStepSize' | 'maxRayDistance'
    | 'perspectiveStepScale' | 'minDensity' | 'minExtinction' | 'minTransmittance'
    | 'maxIterationCountToSun' | 'maxIterationCountToGround'
    | 'minSecondaryStepSize' | 'secondaryStepScale'
    | 'maxShadowLengthIterationCount' | 'minShadowLengthStepSize'
    | 'maxShadowLengthRayDistance' | 'shadowCascadeCount'>>
  /** BSM 结构 + 生成端 march（spec §3 BSM 表；march 含恒定量 opticalDepthTailScale=2，
   *  来源参考库 ShadowMaterial.ts:104 而非 qualityPresets.ts——spec §3 表注）。 */
  shadow: { cascadeCount: number; mapSize: number; march: CloudsShadowMarchParameters }
  /**
   * temporal upscale 降采样分母（涂抹修复 T1，2026-09-02）：2 = 半分 march（RT 面积 ×4，
   * 涂抹感约减半、帧率代价需实测）。可选——未设的档位继承缺省 1（2026-09-02 用户定稿
   * 全分 TAA 档；T1 合并时缺省 4=three 原文行为）。
   * 目前仅 ultra 设 2；用户显式 options.upscaleDivisor 优先于档位（spec §5 合并规则）。
   */
  upscaleDivisor?: 1 | 2 | 4
}

// high/defaults 基线（= defaultCloudsParameters 现状，spec §3「high」列）
const HIGH_MAIN = { lightShafts: true, shapeDetail: true, turbulence: true, accurateSunSkyLight: true } as const
const HIGH_MARCH: CloudsShadowMarchParameters = {
  maxIterationCount: 50, minStepSize: 100, maxStepSize: 1000,
  minDensity: 1e-5, minExtinction: 1e-5, minTransmittance: 1e-4, opticalDepthTailScale: 2
}

export const cloudsQualityPresets: Record<CloudsQualityPreset, ResolvedCloudsQuality> = {
  // low：全编译开关关 + 主 march 200 步/宽阈值 10× + 次 march 1/0 + BSM 2 级联 256/25 步
  low: {
    main: { lightShafts: false, shapeDetail: false, turbulence: false, accurateSunSkyLight: false },
    params: {
      maxIterationCount: 200, minStepSize: 100, maxRayDistance: 1e5,
      minDensity: 1e-4, minExtinction: 1e-4, minTransmittance: 1e-1,
      maxIterationCountToSun: 1, maxIterationCountToGround: 0,
      shadowCascadeCount: 2
    },
    shadow: { cascadeCount: 2, mapSize: 256, march: { ...HIGH_MARCH, maxIterationCount: 25, minDensity: 1e-4, minExtinction: 1e-4, minTransmittance: 1e-2 } }
  },
  // medium：仅 shapeDetail 开；阈值放宽；次 march 2/1；BSM 3 级联 256
  //（minTransmittance 1e-2 / maxIterationCount 500 / toSun 2 = 继承 defaults，不显式列）
  medium: {
    main: { lightShafts: false, shapeDetail: true, turbulence: false, accurateSunSkyLight: false },
    params: { minDensity: 1e-4, minExtinction: 1e-4, maxIterationCountToGround: 1, shadowCascadeCount: 3 },
    shadow: { cascadeCount: 3, mapSize: 256, march: { ...HIGH_MARCH, minDensity: 1e-4, minExtinction: 1e-4 } }
  },
  // high = defaults（零回归基线；params 仅投影 shadowCascadeCount）
  high: {
    main: { ...HIGH_MAIN },
    params: { shadowCascadeCount: 3 },
    shadow: { cascadeCount: 3, mapSize: 512, march: { ...HIGH_MARCH } }
  },
  // ultra：仅 minStepSize 50→10 + mapSize 512→1024
  // ultra：minStepSize 50→10 + mapSize 512→1024 + march 半分（upscaleDivisor=2，涂抹修复 T1）
  ultra: {
    main: { ...HIGH_MAIN },
    params: { minStepSize: 10, shadowCascadeCount: 3 },
    shadow: { cascadeCount: 3, mapSize: 1024, march: { ...HIGH_MARCH } },
    upscaleDivisor: 2
  }
}

/** applyQualityPreset 结果（buildImpl 消费；spec §5 合并语义的机器形态）。 */
export interface AppliedCloudsQuality {
  /** 编译开关全解（含 shadowCascadeCount——恒取档位源）。 */
  main: { lightShafts: boolean; shapeDetail: boolean; turbulence: boolean; accurateSunSkyLight: boolean; shadowCascadeCount: number }
  /** 全量业务参数（新对象——deep-clone 语义，绝不与用户对象/档位常量共享引用）。 */
  params: CloudsParameters
  /** BSM 结构（mapSize 此时尚未消费——Task 4 buildImpl 接线）。 */
  shadow: { cascadeCount: number; mapSize: number }
  /** upscale 降采样分母（解析后必有值：用户显式 > 档位 > 缺省 1=全分 TAA；2026-09-02 定稿）。 */
  upscaleDivisor: 1 | 2 | 4
}

/**
 * 应用档位并合并用户显式参数（spec §5：缺省 → 档位 → 用户显式；产物 deep-clone）。
 *
 * @param quality 档位名。
 * @param options 用户原始选项（CloudsStageOptions；仅消费编译开关字段与 parameters）。
 */
export function applyQualityPreset(quality: CloudsQualityPreset, options: CloudsStageOptions): AppliedCloudsQuality {
  const preset = cloudsQualityPresets[quality]

  // quality 在场：用户 shadowCascadeCount 忽略 + warn（spec §5 v3——防 define/结构双源漂移）
  if (options.parameters?.shadowCascadeCount != null && options.parameters.shadowCascadeCount !== preset.shadow.cascadeCount) {
    console.warn('[clouds] quality 在场时忽略用户 shadowCascadeCount（单一来源：档位 shadow.cascadeCount，spec §5）')
  }

  // main：档位 → 用户显式（shadowCascadeCount 恒档位源）
  const main: AppliedCloudsQuality['main'] = {
    lightShafts: options.lightShafts ?? preset.main.lightShafts,
    shapeDetail: options.shapeDetail ?? preset.main.shapeDetail,
    turbulence: options.turbulence ?? preset.main.turbulence,
    accurateSunSkyLight: options.accurateSunSkyLight ?? preset.main.accurateSunSkyLight,
    shadowCascadeCount: preset.shadow.cascadeCount
  }

  // params：defaultCloudsParameters()（每次新对象）→ 档位覆盖 → 用户字段级覆盖
  const params = defaultCloudsParameters()
  Object.assign(params, preset.params)
  params.shadowMarch = { ...preset.shadow.march }
  const user = options.parameters
  if (user != null) {
    for (const key of Object.keys(user) as (keyof CloudsParameters)[]) {
      const v = user[key] as unknown
      if (v === undefined) continue
      if (key === 'shadowCascadeCount') continue // 单一来源：档位独占
      if (key === 'shadowMarch') {
        params.shadowMarch = { ...(v as CloudsShadowMarchParameters) } // 整对象覆盖（spec §5）
        continue
      }
      if (key === 'shadowIntervals' || key === 'shadowMatrices') continue // dummy 由档位截断生成
      // Cesium 数学类型 clone（防共享引用被 preRender 逐帧覆写互踩，spec §5 clone 规则）
      ;(params as unknown as Record<string, unknown>)[key] =
        v != null && typeof (v as { clone?: unknown }).clone === 'function'
          ? (v as { clone: () => unknown }).clone()
          : v
    }
  }

  // dummy 数组按 cascadeCount 截断 + 可变 identity 实例（spec §4；勿用冻结 Matrix4.IDENTITY）
  const n = preset.shadow.cascadeCount
  params.shadowCascadeCount = n
  params.shadowIntervals = Array.from({ length: n }, () => new Cartesian2(0, 0))
  params.shadowMatrices = Array.from({ length: n }, () => new Matrix4())

  // upscaleDivisor：用户显式 > 档位 > 缺省 1（2026-09-02 用户定稿全分 TAA 档为默认；
  // T1 合并时缺省 4=three 原文零回归，ultra 档显式 2 沿用）
  const upscaleDivisor: 1 | 2 | 4 = options.upscaleDivisor ?? preset.upscaleDivisor ?? 1

  return { main, params, shadow: { cascadeCount: n, mapSize: preset.shadow.mapSize }, upscaleDivisor }
}
