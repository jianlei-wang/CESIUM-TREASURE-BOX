import type { CaseProfile } from '../terrain-analysis-lib/workbench-types'
import { paramNumber, paramString } from '../terrain-analysis-lib/workbench-types'
import {
  cellSizeMeters,
  computeFlowAccumulation,
  computeFlowDirection,
  fillDepressions,
  focalMean
} from '../terrain-analysis-lib/hydrology'
import { classBreaks, gridStats, slopeAspectGrids } from '../terrain-analysis-lib/palette'
import { demTransform, marchingSquaresContours } from '../terrain-analysis-lib/vectorize'
import { nowMs, percent, round } from '../terrain-analysis-lib/util'

const FLOOD_PALETTES: Record<string, string[]> = {
  '4': ['#2c7bb6', '#ffffbf', '#fdae61', '#d7191c'],
  '5': ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c']
}

const FLOOD_LABELS: Record<string, string[]> = {
  '4': ['低风险', '中等风险', '较高风险', '极高风险'],
  '5': ['极低', '较低', '中等', '较高', '极高']
}

export const floodRiskProfile: CaseProfile = {
  id: 'urban-flood-risk',
  title: '城市内涝风险评估（简版）',
  reportTitle: '城市内涝风险评估报告',
  fileNamePrefix: 'flood-risk',
  intro:
    '综合汇流累积、地形低洼程度与坡度三类因子，并叠加降雨强度，评估城市地表内涝风险等级，识别易积水、排水不畅的高风险区。',
  summaryTitle: '城市内涝风险结果',
  route: {
    title: '城市内涝风险评估技术路线',
    intro: '在 DEM 上完成洼地填充、D8 流向与汇流累积，结合地形位置指数（TPI）与坡度构建孕灾因子，再叠加降雨强度加权得到风险指数并分级。',
    steps: [
      { title: '1. 水文预处理', text: '对 DEM 填洼消除伪洼地，计算 D8 流向与汇流累积，获得每个像元的汇水强度。' },
      { title: '2. 低洼程度因子', text: '用地形位置指数 TPI = 高程 − 邻域均值衡量相对低洼，TPI 越低越易汇水。' },
      { title: '3. 坡度因子', text: '坡度越缓，地表径流越慢、越易滞留，内涝危险性越高。' },
      { title: '4. 降雨强度叠加', text: '以降雨强度作为外部驱动，放大孕灾因子评分，得到风险指数。' },
      { title: '5. 分级与高风险区提取', text: '风险指数分位数分级设色，并按阈值提取高风险区等值线。' },
      { title: '6. 成果输出', text: '风险栅格导出 GeoTIFF，高风险区边界导出 SHP/GeoJSON，并生成在线报告与 PDF。' }
    ]
  },
  params: [
    {
      key: 'wAccumulation',
      label: '汇流权重',
      kind: 'slider',
      hint: '汇流累积因子权重，反映上游来水量对内涝风险的影响。',
      default: 0.45,
      min: 0,
      max: 1,
      step: 0.05
    },
    {
      key: 'wTpi',
      label: '低洼权重',
      kind: 'slider',
      hint: '地形低洼程度（TPI 负值）因子权重，低洼处越易积水。',
      default: 0.35,
      min: 0,
      max: 1,
      step: 0.05
    },
    {
      key: 'wSlope',
      label: '坡度权重',
      kind: 'slider',
      hint: '坡度因子权重，坡度越缓排水越慢、风险越高。',
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.05
    },
    {
      key: 'rainfall',
      label: '降雨强度（mm）',
      kind: 'slider',
      hint: '设计降雨量，越大风险指数越高，可用于不同重现期情景对比。',
      default: 50,
      min: 10,
      max: 150,
      step: 5,
      unit: 'mm'
    },
    {
      key: 'tpiWindow',
      label: '低洼邻域窗口',
      kind: 'slider',
      hint: '计算 TPI 的邻域窗口（奇数像元），窗口越大越反映宏观洼地。',
      default: 5,
      min: 3,
      max: 15,
      step: 2,
      unit: 'px'
    },
    {
      key: 'tpiScale',
      label: '低洼敏感尺度（m）',
      kind: 'number',
      hint: 'TPI 低于多少米时视为完全低洼，用于归一化低洼得分。',
      default: 5,
      min: 1,
      max: 30,
      step: 1,
      unit: 'm'
    },
    {
      key: 'slopeMax',
      label: '坡度归一上限（°）',
      kind: 'slider',
      hint: '坡度超过该值时排水通畅、坡度得分取 0。',
      default: 10,
      min: 3,
      max: 30,
      step: 1,
      unit: '°'
    },
    {
      key: 'classCount',
      label: '分级数量',
      kind: 'select',
      hint: '内涝风险分级数量。',
      default: '5',
      options: [
        { label: '4 级', value: '4' },
        { label: '5 级', value: '5' }
      ]
    },
    {
      key: 'riskThreshold',
      label: '高风险阈值',
      kind: 'slider',
      hint: '风险指数超过该值提取为高风险区等值线。',
      default: 70,
      min: 40,
      max: 95,
      step: 1
    },
    {
      key: 'contourMinLength',
      label: '等值线最小长度',
      kind: 'slider',
      hint: '过滤短小等值线，仅保留主要高风险区边界。',
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
    const wAccumulation = paramNumber(params, 'wAccumulation', 0.45)
    const wTpi = paramNumber(params, 'wTpi', 0.35)
    const wSlope = paramNumber(params, 'wSlope', 0.2)
    const rainfall = paramNumber(params, 'rainfall', 50)
    const tpiWindow = Math.max(1, Math.round(paramNumber(params, 'tpiWindow', 5)))
    const tpiScale = Math.max(0.5, paramNumber(params, 'tpiScale', 5))
    const slopeMax = Math.max(1, paramNumber(params, 'slopeMax', 10))
    const classCount = Number(paramString(params, 'classCount', '5'))
    const riskThreshold = paramNumber(params, 'riskThreshold', 70)
    const contourMinLength = paramNumber(params, 'contourMinLength', 6)
    const contourSmooth = paramNumber(params, 'contourSmooth', 0.8)

    const weightSum = Math.max(1e-6, wAccumulation + wTpi + wSlope)
    const nwAcc = wAccumulation / weightSum
    const nwTpi = wTpi / weightSum
    const nwSlope = wSlope / weightSum

    const surface = fillDepressions(dem.values, width, height)
    const flowDir = computeFlowDirection(surface, width, height)
    const acc = computeFlowAccumulation(flowDir, width, height)
    const tHydro = nowMs()

    const neighborhoodMean = focalMean(surface, width, height, tpiWindow)
    const { slopeDeg } = slopeAspectGrids(dem)
    const { cellX, cellY } = cellSizeMeters(dem.west, dem.east, dem.south, dem.north, width, height)
    const n = width * height
    const tpi = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      tpi[i] = Number.isFinite(neighborhoodMean[i]) ? dem.values[i] - neighborhoodMean[i] : Number.NaN
    }
    const tTpi = nowMs()

    const accMax = Math.max(1, gridStats(acc).p98)
    const logMax = Math.log(1 + accMax)
    const rainfallFactor = Math.max(0.4, Math.min(2.2, rainfall / 50))
    const risk = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      if (!mask[i]) {
        risk[i] = Number.NaN
        continue
      }
      const accScore = Math.min(1, Math.log(1 + acc[i]) / logMax)
      const lowScore = Math.max(0, Math.min(1, -tpi[i] / tpiScale))
      const slopeScore = Math.max(0, 1 - slopeDeg[i] / slopeMax)
      const hazard = nwAcc * accScore + nwTpi * lowScore + nwSlope * slopeScore
      risk[i] = Math.max(0, Math.min(100, hazard * rainfallFactor * 100))
    }
    const tScore = nowMs()

    const stats = gridStats(risk)
    const tpiStats = gridStats(tpi)
    const breaks = classBreaks(risk, 'quantile', classCount)
    const colors = FLOOD_PALETTES[String(classCount)] ?? FLOOD_PALETTES['5']
    const labels = FLOOD_LABELS[String(classCount)] ?? FLOOD_LABELS['5']

    let highCells = 0
    let lowCells = 0
    const lowThreshold = 40
    for (let i = 0; i < n; i += 1) {
      if (!Number.isFinite(risk[i])) continue
      if (risk[i] >= riskThreshold) highCells += 1
      if (risk[i] < lowThreshold) lowCells += 1
    }

    const contours = marchingSquaresContours(risk, width, height, riskThreshold, {
      transform: demTransform(dem),
      minLengthPx: contourMinLength,
      simplifyTolerance: contourSmooth
    })
    const tVector = nowMs()

    const accOut = new Float32Array(n)
    const tpiOut = new Float32Array(n)
    const slopeOut = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      accOut[i] = mask[i] ? acc[i] : Number.NaN
      tpiOut[i] = mask[i] ? tpi[i] : Number.NaN
      slopeOut[i] = mask[i] ? slopeDeg[i] : Number.NaN
    }

    return {
      layers: [
        {
          type: 'raster',
          id: 'floodRisk',
          name: '内涝风险指数',
          values: risk,
          style: { classes: { breaks, colors }, hillshade: 0.2 },
          legendLabels: breaks
            .map((value, index) => `${labels[index] ?? `等级 ${index + 1}`} ≤ ${round(value, 1)}`)
            .concat([`${labels[labels.length - 1]} > ${round(breaks[breaks.length - 1] ?? 0, 1)}`]),
          description: `风险指数 ${round(stats.min, 1)} ~ ${round(stats.max, 1)}，均值 ${round(stats.mean, 1)}。降雨强度 ${rainfall} mm，权重：汇流 ${round(nwAcc, 2)}、低洼 ${round(nwTpi, 2)}、坡度 ${round(nwSlope, 2)}。`
        },
        {
          type: 'raster',
          id: 'flowAccumulation',
          name: '汇流累积',
          values: accOut,
          style: { ramp: 'depth', vmin: 0, vmax: accMax, hillshade: 0.2 },
          legendLabels: ['0', `${round(accMax, 0)}`],
          description: 'D8 汇流累积像元数，高值区为上游径流集中汇入处，是内涝的主控因子。'
        },
        {
          type: 'raster',
          id: 'tpi',
          name: '地形位置指数（TPI）',
          values: tpiOut,
          style: { ramp: 'spectral', vmin: Math.min(-Math.abs(tpiStats.min), -1), vmax: Math.max(1, tpiStats.max), hillshade: 0.2 },
          legendLabels: [`低洼 ${round(tpiStats.min, 2)} m`, `凸起 ${round(tpiStats.max, 2)} m`],
          description: 'TPI 为负表示低于周边（易汇水），为正表示高于周边（易排水）。'
        },
        {
          type: 'raster',
          id: 'slope',
          name: '坡度',
          values: slopeOut,
          style: { ramp: 'thermal', vmin: 0, vmax: Math.max(1, gridStats(slopeOut).p98), hillshade: 0.3 },
          legendLabels: ['0°', `${round(Math.max(1, gridStats(slopeOut).p98), 1)}°`],
          description: '坡度越缓径流越慢，内涝风险越高。'
        },
        {
          type: 'vector',
          id: 'highRiskContour',
          name: `高风险区等值线（${riskThreshold}）`,
          geometry: 'line',
          color: '#c1261b',
          width: 2,
          features: contours.map((path) => ({ path, attrs: { 阈值: riskThreshold, 顶点数: path.length } })),
          legend: [{ color: '#c1261b', label: `风险指数 = ${riskThreshold} 边界` }],
          description: `按风险指数 ${riskThreshold} 提取高风险区等值线，共 ${contours.length} 条。`
        }
      ],
      defaultLayerId: 'floodRisk',
      stats: [
        { label: '分析像元', value: `${stats.count} 个` },
        { label: '平均风险指数', value: round(stats.mean, 1) },
        { label: '高风险区占比', value: percent(highCells, stats.count) },
        { label: '低风险区占比', value: percent(lowCells, stats.count) },
        { label: '降雨强度', value: `${rainfall} mm` },
        { label: '像元尺寸', value: `${round(cellX, 1)}×${round(cellY, 1)} m` }
      ],
      timing: [
        { label: '填洼与汇流', value: tHydro - start },
        { label: 'TPI 计算', value: tTpi - tHydro },
        { label: '风险评分', value: tScore - tTpi },
        { label: '等值线矢量化', value: tVector - tScore }
      ],
      summary:
        '内涝高风险区通常位于地势低洼、坡度平缓且上游汇流集中的区域。汇流累积大、TPI 明显为负的地带最易积水，应优先布置排水设施与雨水调蓄空间；高坡或凸起区风险较低。',
      conclusions: [
        `风险指数主要介于 ${round(stats.p2, 1)} ~ ${round(stats.p98, 1)}，均值 ${round(stats.mean, 1)}（降雨 ${rainfall} mm）。`,
        `风险指数不低于 ${riskThreshold} 的高风险区占分析面积约 ${percent(highCells, stats.count)}，低于 ${lowThreshold} 的低风险区约占 ${percent(lowCells, stats.count)}。`,
        `TPI 最低约 ${round(tpiStats.min, 2)} m，这些明显低洼且汇流集中的像元是内涝防治的重点。`
      ]
    }
  }
}
