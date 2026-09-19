import type { CaseProfile } from '../terrain-analysis-lib/workbench-types'
import { paramNumber, paramString } from '../terrain-analysis-lib/workbench-types'
import { cellSizeMeters, computeFlowAccumulation, computeFlowDirection, fillDepressions } from '../terrain-analysis-lib/hydrology'
import { classBreaks, gridStats, slopeAspectGrids } from '../terrain-analysis-lib/palette'
import { demTransform, marchingSquaresContours } from '../terrain-analysis-lib/vectorize'
import { nowMs, percent, round } from '../terrain-analysis-lib/util'

const SUIT_PALETTES: Record<string, string[]> = {
  '4': ['#c1261b', '#f2d43d', '#9bd15a', '#1a9850'],
  '5': ['#c1261b', '#e07a2f', '#f2d43d', '#9bd15a', '#1a9850']
}

const SUIT_LABELS: Record<string, string[]> = {
  '4': ['不适宜', '一般', '较适宜', '最适宜'],
  '5': ['不适宜', '较不适宜', '一般', '较适宜', '最适宜']
}

export const suitabilityProfile: CaseProfile = {
  id: 'land-use-suitability',
  title: '土地利用适宜性评价',
  reportTitle: '土地利用适宜性评价报告',
  fileNamePrefix: 'suitability',
  intro:
    '以坡度、高程、坡向与地形湿润指数为因子，按权重进行多因子加权叠加，得到土地利用适宜性指数，并按适宜程度分级，用于识别适宜开发与需保护的区域。',
  summaryTitle: '土地利用适宜性结果',
  route: {
    title: '土地利用适宜性评价技术路线',
    intro: '选取坡度、高程、坡向、湿润指数四类地形因子，分别归一化为 0~1 适宜性得分，按 AHP 式权重加权叠加为 0~100 综合得分，并分级与提取适宜区。',
    steps: [
      { title: '1. 因子选取', text: '选择对土地利用影响显著的地形因子：坡度（工程难度）、高程（气候与交通）、坡向（光照）、湿润指数（水分条件）。' },
      { title: '2. 因子归一化', text: '坡度越小得分越高；高程以最优带为中心向两侧衰减；坡向以正南最优；湿润指数按范围线性归一。' },
      { title: '3. 权重设置', text: '为各因子设置权重，系统按权重之和自动归一化，体现不同因子的相对重要性。' },
      { title: '4. 约束修正', text: '对超过极限坡度的像元施加惩罚，得到符合建设/耕作约束的适宜性得分。' },
      { title: '5. 综合评分与分级', text: '加权求和得到 0~100 适宜性指数，用分位数法分为不适宜到最适宜若干等级。' },
      { title: '6. 适宜区提取与输出', text: '按阈值提取适宜区等值线，栅格导出 GeoTIFF、矢量导出 SHP/GeoJSON，并生成报告。' }
    ]
  },
  params: [
    {
      key: 'wSlope',
      label: '坡度权重',
      kind: 'slider',
      hint: '坡度因子在综合评分中的权重，权重越高越强调地形平缓程度对适宜性的影响。',
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.05
    },
    {
      key: 'wElevation',
      label: '高程权重',
      kind: 'slider',
      hint: '高程因子的权重，用于体现高程对气候、交通与工程条件的影响。',
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.05
    },
    {
      key: 'wAspect',
      label: '坡向权重',
      kind: 'slider',
      hint: '坡向因子的权重，用于体现光照与坡面朝向对利用条件的影响。',
      default: 0.15,
      min: 0,
      max: 1,
      step: 0.05
    },
    {
      key: 'wWetness',
      label: '湿润权重',
      kind: 'slider',
      hint: '湿润指数因子的权重，用于体现水分条件（汇水与坡度）对利用条件的影响。',
      default: 0.25,
      min: 0,
      max: 1,
      step: 0.05
    },
    {
      key: 'slopeMax',
      label: '极限坡度（°）',
      kind: 'slider',
      hint: '允许利用的最大坡度，超过该坡度的像元适宜性将被显著惩罚。',
      default: 25,
      min: 5,
      max: 45,
      step: 1,
      unit: '°'
    },
    {
      key: 'elevationOptimal',
      label: '最适高程（m）',
      kind: 'number',
      hint: '适宜性最高的高程中心值，高程偏离该值越多得分越低。',
      default: 1200,
      min: 0,
      max: 5000,
      step: 50,
      unit: 'm'
    },
    {
      key: 'elevationTolerance',
      label: '高程容差（m）',
      kind: 'slider',
      hint: '高程得分的衰减尺度，容差越大高程适宜范围越宽。',
      default: 800,
      min: 100,
      max: 3000,
      step: 50,
      unit: 'm'
    },
    {
      key: 'classCount',
      label: '分级数量',
      kind: 'select',
      hint: '适宜性分级数量。',
      default: '5',
      options: [
        { label: '4 级', value: '4' },
        { label: '5 级', value: '5' }
      ]
    },
    {
      key: 'suitableThreshold',
      label: '适宜区阈值',
      kind: 'slider',
      hint: '综合得分超过该值提取为适宜区等值线。',
      default: 65,
      min: 30,
      max: 95,
      step: 1
    },
    {
      key: 'contourMinLength',
      label: '等值线最小长度',
      kind: 'slider',
      hint: '过滤短小等值线，仅保留主要适宜区边界。',
      default: 6,
      min: 2,
      max: 40,
      step: 1,
      unit: 'px'
    },
    {
      key: 'contourSmooth',
      label: '等值线简化容差',
      kind: 'slider',
      hint: 'Douglas-Peucker 简化容差，越大折线越平滑。',
      default: 0.8,
      min: 0.2,
      max: 3,
      step: 0.1,
      unit: 'px'
    }
  ],
  analyze: ({ dem, mask, params }) => {
    const start = nowMs()
    const { width, height } = dem
    const wSlope = paramNumber(params, 'wSlope', 0.4)
    const wElevation = paramNumber(params, 'wElevation', 0.2)
    const wAspect = paramNumber(params, 'wAspect', 0.15)
    const wWetness = paramNumber(params, 'wWetness', 0.25)
    const slopeMax = paramNumber(params, 'slopeMax', 25)
    const elevationOptimal = paramNumber(params, 'elevationOptimal', 1200)
    const elevationTolerance = Math.max(50, paramNumber(params, 'elevationTolerance', 800))
    const classCount = Number(paramString(params, 'classCount', '5'))
    const suitableThreshold = paramNumber(params, 'suitableThreshold', 65)
    const contourMinLength = paramNumber(params, 'contourMinLength', 6)
    const contourSmooth = paramNumber(params, 'contourSmooth', 0.8)

    const weightSum = Math.max(1e-6, wSlope + wElevation + wAspect + wWetness)
    const nwSlope = wSlope / weightSum
    const nwElevation = wElevation / weightSum
    const nwAspect = wAspect / weightSum
    const nwWetness = wWetness / weightSum

    const { tan, slopeDeg, aspectDeg } = slopeAspectGrids(dem)
    const tSlope = nowMs()

    const surface = fillDepressions(dem.values, width, height)
    const flowDir = computeFlowDirection(surface, width, height)
    const acc = computeFlowAccumulation(flowDir, width, height)
    const { cellX, cellY } = cellSizeMeters(dem.west, dem.east, dem.south, dem.north, width, height)
    const cellSize = (cellX + cellY) / 2
    const tanMin = Math.tan((0.5 * Math.PI) / 180)
    const n = width * height
    const twi = new Float32Array(n)
    const elevationScore = new Float32Array(n)
    const slopeScore = new Float32Array(n)
    const aspectScore = new Float32Array(n)
    let twiMin = Number.POSITIVE_INFINITY
    let twiMax = Number.NEGATIVE_INFINITY
    for (let i = 0; i < n; i += 1) {
      if (!mask[i]) {
        twi[i] = Number.NaN
        continue
      }
      const value = Math.log(((acc[i] + 1) * cellSize) / Math.max(tanMin, tan[i]))
      twi[i] = value
      if (value < twiMin) twiMin = value
      if (value > twiMax) twiMax = value
    }
    const twiSpan = Math.max(1e-6, twiMax - twiMin)
    const tTwI = nowMs()

    const suitability = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      if (!mask[i]) {
        suitability[i] = Number.NaN
        continue
      }
      const slope = slopeDeg[i]
      const wet = (twi[i] - twiMin) / twiSpan
      slopeScore[i] = Math.max(0, 1 - slope / Math.max(1, slopeMax))
      elevationScore[i] = Math.max(0, 1 - Math.abs(dem.values[i] - elevationOptimal) / elevationTolerance)
      const asp = aspectDeg[i]
      aspectScore[i] = asp < 0 ? 1 : (Math.cos(((asp - 180) * Math.PI) / 180) + 1) / 2
      let score = (nwSlope * slopeScore[i] + nwElevation * elevationScore[i] + nwAspect * aspectScore[i] + nwWetness * wet) * 100
      if (slope > slopeMax) score *= 0.15
      suitability[i] = Math.max(0, Math.min(100, score))
    }
    const tScore = nowMs()

    const stats = gridStats(suitability)
    const slopeStats = gridStats(slopeDeg)
    const breaks = classBreaks(suitability, 'quantile', classCount)
    const colors = SUIT_PALETTES[String(classCount)] ?? SUIT_PALETTES['5']
    const labels = SUIT_LABELS[String(classCount)] ?? SUIT_LABELS['5']

    let suitableCells = 0
    let poorCells = 0
    const poorThreshold = 40
    for (let i = 0; i < n; i += 1) {
      if (!Number.isFinite(suitability[i])) continue
      if (suitability[i] >= suitableThreshold) suitableCells += 1
      if (suitability[i] < poorThreshold) poorCells += 1
    }

    const contours = marchingSquaresContours(suitability, width, height, suitableThreshold, {
      transform: demTransform(dem),
      minLengthPx: contourMinLength,
      simplifyTolerance: contourSmooth
    })
    const tVector = nowMs()

    const wetnessOut = new Float32Array(n)
    for (let i = 0; i < n; i += 1) wetnessOut[i] = mask[i] ? twi[i] : Number.NaN

    return {
      layers: [
        {
          type: 'raster',
          id: 'suitability',
          name: '综合适宜性',
          values: suitability,
          style: { classes: { breaks, colors }, hillshade: 0.25 },
          legendLabels: breaks
            .map((value, index) => `${labels[index] ?? `等级 ${index + 1}`} ≤ ${round(value, 1)}`)
            .concat([`${labels[labels.length - 1]} > ${round(breaks[breaks.length - 1] ?? 0, 1)}`]),
          description: `综合适宜性得分 ${round(stats.min, 1)} ~ ${round(stats.max, 1)}，均值 ${round(stats.mean, 1)}。权重：坡度 ${round(nwSlope, 2)}、高程 ${round(nwElevation, 2)}、坡向 ${round(nwAspect, 2)}、湿润 ${round(nwWetness, 2)}。`
        },
        {
          type: 'raster',
          id: 'slope',
          name: '坡度',
          values: (() => {
            const out = new Float32Array(n)
            for (let i = 0; i < n; i += 1) out[i] = mask[i] ? slopeDeg[i] : Number.NaN
            return out
          })(),
          style: { ramp: 'thermal', vmin: 0, vmax: Math.max(1, slopeStats.p98), hillshade: 0.35 },
          legendLabels: ['0°', `${round(Math.max(1, slopeStats.p98), 1)}°`],
          description: `坡度均值 ${round(slopeStats.mean, 2)}°，是适宜性的主导因子之一。`
        },
        {
          type: 'raster',
          id: 'elevationScore',
          name: '高程适宜性因子',
          values: (() => {
            const out = new Float32Array(n)
            for (let i = 0; i < n; i += 1) out[i] = mask[i] ? elevationScore[i] : Number.NaN
            return out
          })(),
          style: { ramp: 'greens', vmin: 0, vmax: 1, hillshade: 0.2 },
          legendLabels: ['低（0）', '高（1）'],
          description: `以最适高程 ${elevationOptimal} m 为中心、容差 ${elevationTolerance} m 归一化得到的高程得分。`
        },
        {
          type: 'raster',
          id: 'wetness',
          name: '地形湿润指数',
          values: wetnessOut,
          style: { ramp: 'blues', vmin: twiMin, vmax: twiMax, hillshade: 0.25 },
          legendLabels: [round(twiMin, 1), round(twiMax, 1)],
          description: '按汇水面积与坡度计算的地形湿润指数，作为水分条件因子。'
        },
        {
          type: 'vector',
          id: 'suitableContour',
          name: `适宜区等值线（${suitableThreshold} 分）`,
          geometry: 'line',
          color: '#1a9850',
          width: 2,
          features: contours.map((path) => ({ path, attrs: { 阈值: suitableThreshold, 顶点数: path.length } })),
          legend: [{ color: '#1a9850', label: `适宜性 = ${suitableThreshold} 分边界` }],
          description: `按适宜性得分 ${suitableThreshold} 提取适宜区等值线，共 ${contours.length} 条。`
        }
      ],
      defaultLayerId: 'suitability',
      stats: [
        { label: '分析像元', value: `${stats.count} 个` },
        { label: '平均适宜性', value: round(stats.mean, 1) },
        { label: '适宜区占比', value: percent(suitableCells, stats.count) },
        { label: '不适宜占比', value: percent(poorCells, stats.count) },
        { label: '平均坡度', value: `${round(slopeStats.mean, 2)}°` },
        { label: '最适高程', value: `${elevationOptimal} m` }
      ],
      timing: [
        { label: '坡度/坡向', value: tSlope - start },
        { label: '湿润指数', value: tTwI - tSlope },
        { label: '加权评分', value: tScore - tTwI },
        { label: '等值线矢量化', value: tVector - tScore }
      ],
      summary:
        '适宜性指数综合了地形平坦程度、高程、光照朝向与水分条件。高值区多位于坡度平缓、高程适中、朝南且水分条件良好的区域，适合农业或建设利用；低值区坡度陡、高程不适或阴坡，宜保留为生态用地。',
      conclusions: [
        `综合适宜性得分主要介于 ${round(stats.p2, 1)} ~ ${round(stats.p98, 1)}，均值 ${round(stats.mean, 1)}。`,
        `得分不低于 ${suitableThreshold} 的适宜区占分析面积约 ${percent(suitableCells, stats.count)}，低于 40 分的不适宜区约占 ${percent(poorCells, stats.count)}。`,
        `分析区平均坡度 ${round(slopeStats.mean, 2)}°，坡度与高程是控制适宜性空间格局的主要因子。`
      ]
    }
  }
}
