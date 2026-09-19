import type { CaseProfile } from '../terrain-analysis-lib/workbench-types'
import { paramBoolean, paramNumber, paramString } from '../terrain-analysis-lib/workbench-types'
import { cellSizeMeters, computeFlowAccumulation, computeFlowDirection, fillDepressions } from '../terrain-analysis-lib/hydrology'
import { classBreaks, gridStats, slopeAspectGrids } from '../terrain-analysis-lib/palette'
import { demTransform, marchingSquaresContours } from '../terrain-analysis-lib/vectorize'
import { nowMs, percent, round } from '../terrain-analysis-lib/util'

const WET_PALETTES: Record<string, string[]> = {
  '4': ['#a6611a', '#dfc27d', '#80cdc1', '#018571'],
  '5': ['#a6611a', '#dfc27d', '#f5f5f5', '#80cdc1', '#018571'],
  '6': ['#8c510a', '#d8b365', '#f6e8c3', '#c7eae5', '#5ab4ac', '#01665e']
}

const WET_LABELS: Record<string, string[]> = {
  '4': ['极干', '偏干', '湿润', '极湿'],
  '5': ['极干', '干旱', '中等', '湿润', '极湿'],
  '6': ['极干', '干旱', '偏干', '偏湿', '湿润', '极湿']
}

export const twiProfile: CaseProfile = {
  id: 'terrain-wetness-index',
  title: '地形湿润指数（TWI）分析',
  reportTitle: '地形湿润指数（TWI）空间分析报告',
  fileNamePrefix: 'twi',
  intro:
    '基于 DEM 计算地形湿润指数 TWI = ln(a / tanβ)：a 为单宽汇水面积，tanβ 为坡度正切，反映地形对水分的再分配能力，用于识别湿润区与干旱区。',
  summaryTitle: '地形湿润指数结果',
  route: {
    title: '地形湿润指数（TWI）技术路线',
    intro: '从 DEM 出发，经洼地填充与 D8 汇流得到单宽汇水面积，结合坡度正切计算 TWI，再进行分级、等值线提取与输出。',
    steps: [
      { title: '1. DEM 预处理', text: '对分析范围内的 DEM 进行洼地填充，消除封闭低点，保证 D8 流向可解、汇流路径连续。' },
      { title: '2. 流向与汇流累积', text: '采用 D8 最陡下降法确定每个像元流向，并按拓扑顺序累加得到汇流累积量（上游像元数）。' },
      { title: '3. 单宽汇水面积', text: '由汇流累积量与像元边长换算单位等高线宽度的汇水面积 a = (acc+1)·cell，量纲为 m²/m。' },
      { title: '4. 坡度正切', text: '由 DEM 计算坡度正切 tanβ，并对极小值设下限，避免平坦区出现指数发散。' },
      { title: '5. TWI 计算', text: '逐像元计算 TWI = ln(a / tanβ)。值越大代表汇水多、坡度缓，土壤水分更易富集。' },
      { title: '6. 分级与等值线', text: '用分位数/自然断点法对 TWI 分级设色，并用 Marching Squares 提取指定阈值的等值线。' },
      { title: '7. 成果输出', text: '栅格结果可导出 Float32 GeoTIFF，等值线可导出 SHP/GeoJSON，并生成在线报告与 PDF。' }
    ]
  },
  params: [
    {
      key: 'fillSinks',
      label: '填充洼地',
      kind: 'boolean',
      hint: '水文分析前是否填平内部封闭低点。开启后水流方向连续，TWI 分布更稳定；关闭则保留原始洼地。',
      default: true
    },
    {
      key: 'minSlope',
      label: '最小坡度（°）',
      kind: 'slider',
      hint: '计算 tanβ 时的坡度下限。平坦或水面区域坡度接近 0 会使 TWI 发散，设置下限可稳定结果。',
      default: 0.5,
      min: 0.1,
      max: 5,
      step: 0.1,
      unit: '°'
    },
    {
      key: 'classCount',
      label: '分级数量',
      kind: 'select',
      hint: 'TWI 分级设色的等级数量，等级越多湿润程度刻画越细。',
      default: '5',
      options: [
        { label: '4 级', value: '4' },
        { label: '5 级', value: '5' },
        { label: '6 级', value: '6' }
      ]
    },
    {
      key: 'wetThreshold',
      label: '湿润区阈值',
      kind: 'slider',
      hint: '判定高湿区的 TWI 阈值，超过该值提取为湿润区等值线，用于圈定潜在汇水/易涝区。',
      default: 9,
      min: 5,
      max: 14,
      step: 0.1
    },
    {
      key: 'contourMinLength',
      label: '等值线最小长度',
      kind: 'slider',
      hint: '过滤掉小于该像素长度的零碎等值线，仅保留主要湿润区边界。',
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
      hint: 'Douglas-Peucker 简化容差，值越大折线越平滑、顶点越少。',
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
    const fillSinks = paramBoolean(params, 'fillSinks', true)
    const minSlope = paramNumber(params, 'minSlope', 0.5)
    const wetThreshold = paramNumber(params, 'wetThreshold', 9)
    const classCount = Number(paramString(params, 'classCount', '5'))
    const contourMinLength = paramNumber(params, 'contourMinLength', 6)
    const contourSmooth = paramNumber(params, 'contourSmooth', 0.8)

    const surface = fillSinks ? fillDepressions(dem.values, width, height) : dem.values
    const tFill = nowMs()
    const flowDir = computeFlowDirection(surface, width, height)
    const acc = computeFlowAccumulation(flowDir, width, height)
    const tFlow = nowMs()
    const { tan, slopeDeg } = slopeAspectGrids(dem)
    const tSlope = nowMs()

    const { cellX, cellY } = cellSizeMeters(dem.west, dem.east, dem.south, dem.north, width, height)
    const cellSize = (cellX + cellY) / 2
    const tanMin = Math.tan((minSlope * Math.PI) / 180)
    const n = width * height
    const twi = new Float32Array(n)
    const flowAccOut = new Float32Array(n)
    const slopeOut = new Float32Array(n)
    let maxAcc = 0
    for (let i = 0; i < n; i += 1) {
      if (!mask[i]) {
        twi[i] = Number.NaN
        flowAccOut[i] = Number.NaN
        slopeOut[i] = Number.NaN
        continue
      }
      const tanUse = Math.max(tanMin, tan[i])
      const catchment = (acc[i] + 1) * cellSize
      twi[i] = Math.log(catchment / tanUse)
      flowAccOut[i] = acc[i] + 1
      slopeOut[i] = slopeDeg[i]
      if (acc[i] + 1 > maxAcc) maxAcc = acc[i] + 1
    }
    const tIndex = nowMs()

    const stats = gridStats(twi)
    const breaks = classBreaks(twi, 'quantile', classCount)
    const colors = WET_PALETTES[String(classCount)] ?? WET_PALETTES['5']
    const labels = WET_LABELS[String(classCount)] ?? WET_LABELS['5']

    let wetCells = 0
    for (let i = 0; i < n; i += 1) if (Number.isFinite(twi[i]) && twi[i] > wetThreshold) wetCells += 1
    const validCells = stats.count

    const contours = marchingSquaresContours(twi, width, height, wetThreshold, {
      transform: demTransform(dem),
      minLengthPx: contourMinLength,
      simplifyTolerance: contourSmooth
    })
    const tVector = nowMs()

    const slopeStats = gridStats(slopeOut)

    return {
      layers: [
        {
          type: 'raster',
          id: 'twi',
          name: '地形湿润指数',
          values: twi,
          style: { classes: { breaks, colors }, hillshade: 0.3 },
          legendLabels: breaks.map((value, index) => `${labels[index] ?? `等级 ${index + 1}`} ≤ ${round(value, 2)}`).concat([`${labels[labels.length - 1]} > ${round(breaks[breaks.length - 1] ?? 0, 2)}`]),
          description: `湿润指数 TWI = ln(a / tanβ)，取值 ${round(stats.min, 2)} ~ ${round(stats.max, 2)}，均值 ${round(stats.mean, 2)}。高值区汇水充分、坡度平缓，土壤水分易富集。`
        },
        {
          type: 'raster',
          id: 'slope',
          name: '坡度',
          values: slopeOut,
          style: { ramp: 'thermal', vmin: 0, vmax: Math.max(1, slopeStats.p98), hillshade: 0.35 },
          legendLabels: ['0°', `${round(Math.max(1, slopeStats.p98), 1)}°`],
          description: `坡度均值 ${round(slopeStats.mean, 2)}°，最大 ${round(slopeStats.max, 1)}°。坡度越缓，TWI 越高。`
        },
        {
          type: 'raster',
          id: 'flowAcc',
          name: '汇流累积',
          values: flowAccOut,
          style: { ramp: 'blues', vmin: 1, vmax: Math.max(2, maxAcc), logScale: true, hillshade: 0 },
          legendLabels: ['1', String(Math.round(maxAcc))],
          description: `汇流累积最大值 ${Math.round(maxAcc)} 个像元，反映水流汇聚路径。`
        },
        {
          type: 'vector',
          id: 'wetContour',
          name: `湿润区等值线（TWI=${wetThreshold}）`,
          geometry: 'line',
          color: '#1f6fd4',
          width: 2,
          features: contours.map((path) => ({
            path,
            attrs: { 阈值: wetThreshold, 顶点数: path.length }
          })),
          legend: [{ color: '#1f6fd4', label: `TWI = ${wetThreshold} 湿润区边界` }],
          description: `提取 TWI 大于 ${wetThreshold} 的湿润区等值线，共 ${contours.length} 条。`
        }
      ],
      defaultLayerId: 'twi',
      stats: [
        { label: '分析像元', value: `${validCells} 个` },
        { label: 'TWI 均值', value: round(stats.mean, 2) },
        { label: 'TWI 最大', value: round(stats.max, 2) },
        { label: '高湿区占比', value: percent(wetCells, validCells) },
        { label: '最大汇流', value: `${Math.round(maxAcc)} 像元` },
        { label: '平均坡度', value: `${round(slopeStats.mean, 2)}°` }
      ],
      timing: [
        { label: 'DEM 预处理', value: tFill - start },
        { label: '流向与汇流', value: tFlow - tFill },
        { label: '坡度提取', value: tSlope - tFlow },
        { label: 'TWI 计算', value: tIndex - tSlope },
        { label: '等值线矢量化', value: tVector - tIndex }
      ],
      summary:
        'TWI 综合反映地形对水分的再分配：汇水面积大、坡度缓的谷地/洼地湿润指数高，山脊与陡坡低。可据此识别湿润带、潜在湿地与积水易发区。',
      conclusions: [
        `范围内 TWI 主要介于 ${round(stats.p2, 2)} ~ ${round(stats.p98, 2)}（2%~98% 分位），均值 ${round(stats.mean, 2)}。`,
        `TWI 大于 ${wetThreshold} 的高湿区占分析面积约 ${percent(wetCells, validCells)}，多沿汇流路径与低洼地带分布。`,
        `平均坡度 ${round(slopeStats.mean, 2)}°，坡度是控制 TWI 空间差异的主要因子之一。`
      ]
    }
  }
}
