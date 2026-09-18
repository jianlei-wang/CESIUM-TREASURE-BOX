// packages/cesium-clouds/src/cloudLayersPacking.ts
//
// 云层参数 → packed uniforms 派生（spec §6.3）。对齐 three-geospatial
// uniforms.ts packValues/packSums/packIntervalHeights 语义——此前本项目把
// packed 写死在 cloudsDefaultParameters.ts，云高度偏移（?cloudsAltitudeOffset=）
// 需要「改层参数 → 全部派生项重算」的纯函数链。
//
// ⚠️ 重算清单完整版（红队 BLOCKER-4 教训）：packed 4 向量 + minHeight/maxHeight
// 标量（march 入射壳 clouds.frag:835 直接消费）+ shadowTop/BottomHeight（BSM 域）。
// shadowLayerMask 只记层成员，不随高度变。
import { Cartesian2, Cartesian3, Cartesian4 } from 'cesium'

export interface CloudLayerParams {
  altitude: number
  height: number
  densityScale: number
  shapeAmount: number
  shapeDetailAmount: number
  weatherExponent: number
  shapeAlteringBias: number
  coverageFilterWidth: number
  shadow: boolean
}

/**
 * 三层云默认值（结构=CloudLayers.DEFAULT）。
 * 2026-09-04 缺省高度重定（用户「云层整体偏低」）：L0 750→1500、L1 1000→2000（厚度/密度/
 * coverage 不动）——低云甲 750-2200m → 1500-3200m（云底 1500m=温带积云典型云底，
 * 顶 3200m=浓积云合理上限）；L2 高卷云 7500m 物理位置合理不动。packed 派生值自动联动
 * （cloudsDefaultParameters 亦改为本表派生，单一来源）。
 */
export const DEFAULT_CLOUD_LAYERS: CloudLayerParams[] = [
  { altitude: 1500, height: 650, densityScale: 0.2, shapeAmount: 1, shapeDetailAmount: 1, weatherExponent: 1, shapeAlteringBias: 0.35, coverageFilterWidth: 0.6, shadow: true },
  { altitude: 2000, height: 1200, densityScale: 0.2, shapeAmount: 1, shapeDetailAmount: 1, weatherExponent: 1, shapeAlteringBias: 0.35, coverageFilterWidth: 0.6, shadow: true },
  { altitude: 7500, height: 500, densityScale: 0.003, shapeAmount: 0.4, shapeDetailAmount: 0, weatherExponent: 1, shapeAlteringBias: 0.35, coverageFilterWidth: 0.5, shadow: false },
  { altitude: 0, height: 0, densityScale: 0.2, shapeAmount: 1, shapeDetailAmount: 1, weatherExponent: 1, shapeAlteringBias: 0.35, coverageFilterWidth: 0.6, shadow: false }
]

/** 低云带高度偏移 clamp（spec §6.1）。 */
export const ALTITUDE_OFFSET_RANGE: Cartesian2 = new Cartesian2(-500, 3000)

/** 仅低云带 L0/L1 加偏移（clamp；L2 高卷云/L3 不动）。 */
export function applyAltitudeOffset(layers: CloudLayerParams[], offsetM: number): CloudLayerParams[] {
  const clamped = Math.min(Math.max(offsetM, ALTITUDE_OFFSET_RANGE.x), ALTITUDE_OFFSET_RANGE.y)
  return layers.map((l, i) =>
    i <= 1 ? { ...l, altitude: l.altitude + clamped } : { ...l }
  )
}

export interface PackedLayerUniforms {
  minLayerHeights: Cartesian4
  maxLayerHeights: Cartesian4
  minIntervalHeights: Cartesian3
  maxIntervalHeights: Cartesian3
  densityScales: Cartesian4
  shapeAmounts: Cartesian4
  shapeDetailAmounts: Cartesian4
  weatherExponents: Cartesian4
  shapeAlteringBiases: Cartesian4
  coverageFilterWidths: Cartesian4
  minHeight: number
  maxHeight: number
  shadowTopHeight: number
  shadowBottomHeight: number
  shadowLayerMask: Cartesian4
}

// packIntervalHeights（three uniforms.ts:141-180 语义，产出对齐 cloudsDefaultParameters.ts
// L235-238 文档）：求「层间隙空域」区间——无任何层覆盖的高度段，供 march 快速跳跃。
// 端点排序（同高度 open(+1) 先于 close(-1)）后 balance 扫描：0→1（open）处闭合当前
// 空隙 [cursor, h]，1→0（close）处开启新空隙。默认三层 → 空隙 [0,1500] [3200,7500]
// （第三槽 [0,0] 为补位，保留 three 行为；L3 空层 height=0 不产生端点）。
function packIntervalHeights(layers: CloudLayerParams[]): { min: Cartesian3; max: Cartesian3 } {
  const entries: Array<{ h: number; delta: number }> = []
  for (const l of layers) {
    if (l.height <= 0) continue
    entries.push({ h: l.altitude, delta: 1 })
    entries.push({ h: l.altitude + l.height, delta: -1 })
  }
  entries.sort((a, b) => a.h - b.h || b.delta - a.delta)
  const mins: number[] = []
  const maxs: number[] = []
  let balance = 0
  let gapStart = 0
  for (const e of entries) {
    if (e.delta === 1) {
      if (balance === 0 && e.h > gapStart) {
        mins.push(gapStart)
        maxs.push(e.h)
      }
      balance += 1
    } else {
      balance -= 1
      if (balance === 0) gapStart = e.h
    }
  }
  // three 行为：固定 3 槽，不足补 [0,0]
  while (mins.length < 3) {
    mins.push(0)
    maxs.push(0)
  }
  return { min: new Cartesian3(mins[0], mins[1], mins[2]), max: new Cartesian3(maxs[0], maxs[1], maxs[2]) }
}

/** 层参数 → 全部 packed uniforms（cloudsDefaultParameters.ts 同名字段语义）。 */
export function packLayerUniforms(layers: CloudLayerParams[]): PackedLayerUniforms {
  const shadowed = layers.filter((l) => l.shadow && l.height > 0)
  // march 入射壳（clouds.frag:835）须包住真实云体——空层（height=0，如 L3 padding）
  // 不计入 min/max，否则 minHeight 被拉到 0（红队 BLOCKER-4 同族：派生项漏过滤）
  const active = layers.filter((l) => l.height > 0)
  const intervals = packIntervalHeights(layers)
  return {
    minLayerHeights: new Cartesian4(layers[0].altitude, layers[1].altitude, layers[2].altitude, layers[3].altitude),
    maxLayerHeights: new Cartesian4(
      layers[0].altitude + layers[0].height,
      layers[1].altitude + layers[1].height,
      layers[2].altitude + layers[2].height,
      layers[3].altitude + layers[3].height
    ),
    minIntervalHeights: intervals.min,
    maxIntervalHeights: intervals.max,
    densityScales: new Cartesian4(layers[0].densityScale, layers[1].densityScale, layers[2].densityScale, layers[3].densityScale),
    shapeAmounts: new Cartesian4(layers[0].shapeAmount, layers[1].shapeAmount, layers[2].shapeAmount, layers[3].shapeAmount),
    shapeDetailAmounts: new Cartesian4(layers[0].shapeDetailAmount, layers[1].shapeDetailAmount, layers[2].shapeDetailAmount, layers[3].shapeDetailAmount),
    weatherExponents: new Cartesian4(layers[0].weatherExponent, layers[1].weatherExponent, layers[2].weatherExponent, layers[3].weatherExponent),
    shapeAlteringBiases: new Cartesian4(layers[0].shapeAlteringBias, layers[1].shapeAlteringBias, layers[2].shapeAlteringBias, layers[3].shapeAlteringBias),
    coverageFilterWidths: new Cartesian4(layers[0].coverageFilterWidth, layers[1].coverageFilterWidth, layers[2].coverageFilterWidth, layers[3].coverageFilterWidth),
    minHeight: Math.min(...active.map((l) => l.altitude)),
    maxHeight: Math.max(...active.map((l) => l.altitude + l.height)),
    shadowTopHeight: Math.max(...shadowed.map((l) => l.altitude + l.height)),
    shadowBottomHeight: Math.min(...shadowed.map((l) => l.altitude)),
    shadowLayerMask: new Cartesian4(
      layers[0].shadow ? 1 : 0,
      layers[1].shadow ? 1 : 0,
      layers[2].shadow ? 1 : 0,
      layers[3].shadow ? 1 : 0
    )
  }
}
