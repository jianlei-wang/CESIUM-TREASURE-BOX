import type { CaseProfile } from '../terrain-analysis-lib/workbench-types'
import { paramNumber, paramString } from '../terrain-analysis-lib/workbench-types'
import { focalMean } from '../terrain-analysis-lib/hydrology'
import { classBreaks, gridStats, slopeAspectGrids } from '../terrain-analysis-lib/palette'
import { demTransform, marchingSquaresContours } from '../terrain-analysis-lib/vectorize'
import { nowMs, percent, round } from '../terrain-analysis-lib/util'

const TRI_PALETTES: Record<string, string[]> = {
  '4': ['#0d3b66', '#3aa6a6', '#f2d43d', '#c1261b'],
  '5': ['#0d3b66', '#3aa6a6', '#f2d43d', '#e07a2f', '#c1261b'],
  '6': ['#0d3b66', '#2a7f9e', '#5ebf9a', '#f2d43d', '#e07a2f', '#c1261b']
}

const TRI_LABELS: Record<string, string[]> = {
  '4': ['平坦', '较平缓', '较崎岖', '极崎岖'],
  '5': ['平坦', '较平缓', '中等', '较崎岖', '极崎岖'],
  '6': ['平坦', '平缓', '较平缓', '较崎岖', '崎岖', '极崎岖']
}

const NEIGHBORS: [number, number][] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1]
]

export const triProfile: CaseProfile = {
  id: 'terrain-ruggedness-index',
  title: '地形崎岖率（TRI）分析',
  reportTitle: '地形崎岖率（TRI）空间分析报告',
  fileNamePrefix: 'tri',
  intro:
    '地形崎岖率（Terrain Ruggedness Index）度量中心像元与邻域像元的高程差异，反映地表起伏的剧烈程度，数值越大代表地形越崎岖。',
  summaryTitle: '地形崎岖率结果',
  route: {
    title: '地形崎岖率（TRI）技术路线',
    intro: '对 DEM 做可选平滑后，逐像元统计与八邻域的高程差异，得到 Riley / Wilson 两种 TRI，再进行分级与陡峭区等值线提取。',
    steps: [
      { title: '1. 数据预处理', text: '按需对 DEM 进行焦点均值平滑，抑制噪声与孤立高程异常，避免崎岖率被单点噪声放大。' },
      { title: '2. 邻域高程差', text: '对每个像元取八邻域，计算中心像元与各邻居的高程差。' },
      { title: '3. TRI 计算', text: 'Riley 法取高程差平方和再开方；Wilson 法取高程差绝对值的平均，两种口径分别适用于不同尺度。' },
      { title: '4. 分级设色', text: '用分位数法将 TRI 分为若干等级，从平坦到极崎岖依次设色。' },
      { title: '5. 陡峭区提取', text: '以给定 TRI 阈值用 Marching Squares 提取崎岖区等值线，圈定陡峭、破碎地带。' },
      { title: '6. 成果输出', text: 'TRI 栅格导出 Float32 GeoTIFF，等值线导出 SHP/GeoJSON，并生成报告与 PDF。' }
    ]
  },
  params: [
    {
      key: 'method',
      label: '计算方法',
      kind: 'select',
      hint: 'Riley 法为八邻域高程差平方和开方；Wilson 法为高程差绝对值的平均，更稳健。',
      default: 'riley',
      options: [
        { label: 'Riley（平方和开方）', value: 'riley' },
        { label: 'Wilson（绝对差均值）', value: 'wilson' }
      ]
    },
    {
      key: 'smoothWindow',
      label: '平滑窗口',
      kind: 'slider',
      hint: '计算前的高斯/均值平滑窗口（奇数像元），窗口越大越平滑，可抑制 DEM 噪声。',
      default: 3,
      min: 1,
      max: 9,
      step: 2,
      unit: 'px'
    },
    {
      key: 'classCount',
      label: '分级数量',
      kind: 'select',
      hint: 'TRI 分级设色的等级数量。',
      default: '5',
      options: [
        { label: '4 级', value: '4' },
        { label: '5 级', value: '5' },
        { label: '6 级', value: '6' }
      ]
    },
    {
      key: 'ruggedThreshold',
      label: '崎岖区阈值（m）',
      kind: 'slider',
      hint: '判定崎岖区的 TRI 阈值（米），超过该值提取为崎岖区等值线。',
      default: 60,
      min: 5,
      max: 200,
      step: 5,
      unit: 'm'
    },
    {
      key: 'contourMinLength',
      label: '等值线最小长度',
      kind: 'slider',
      hint: '过滤短小等值线，仅保留主要崎岖区边界。',
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
    const method = paramString(params, 'method', 'riley')
    const smoothWindow = Math.max(1, Math.round(paramNumber(params, 'smoothWindow', 3)))
    const classCount = Number(paramString(params, 'classCount', '5'))
    const threshold = paramNumber(params, 'ruggedThreshold', 60)
    const contourMinLength = paramNumber(params, 'contourMinLength', 6)
    const contourSmooth = paramNumber(params, 'contourSmooth', 0.8)

    const base = smoothWindow > 1 ? focalMean(dem.values, width, height, smoothWindow) : dem.values
    const tSmooth = nowMs()

    const n = width * height
    const tri = new Float32Array(n)
    for (let r = 0; r < height; r += 1) {
      for (let c = 0; c < width; c += 1) {
        const i = r * width + c
        const center = base[i]
        if (!mask[i] || !Number.isFinite(center)) {
          tri[i] = Number.NaN
          continue
        }
        let sumSq = 0
        let sumAbs = 0
        let count = 0
        for (const [dr, dc] of NEIGHBORS) {
          const nr = r + dr
          const nc = c + dc
          if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
          const nv = base[nr * width + nc]
          if (!Number.isFinite(nv)) continue
          const diff = center - nv
          sumSq += diff * diff
          sumAbs += Math.abs(diff)
          count += 1
        }
        if (count === 0) {
          tri[i] = Number.NaN
          continue
        }
        tri[i] = method === 'wilson' ? sumAbs / count : Math.sqrt(sumSq)
      }
    }
    const tTri = nowMs()

    const { slopeDeg } = slopeAspectGrids(dem)
    const slopeOut = new Float32Array(n)
    for (let i = 0; i < n; i += 1) slopeOut[i] = mask[i] ? slopeDeg[i] : Number.NaN
    const tSlope = nowMs()

    const stats = gridStats(tri)
    const slopeStats = gridStats(slopeOut)
    const breaks = classBreaks(tri, 'quantile', classCount)
    const colors = TRI_PALETTES[String(classCount)] ?? TRI_PALETTES['5']
    const labels = TRI_LABELS[String(classCount)] ?? TRI_LABELS['5']

    let ruggedCells = 0
    for (let i = 0; i < n; i += 1) if (Number.isFinite(tri[i]) && tri[i] > threshold) ruggedCells += 1

    const contours = marchingSquaresContours(tri, width, height, threshold, {
      transform: demTransform(dem),
      minLengthPx: contourMinLength,
      simplifyTolerance: contourSmooth
    })
    const tVector = nowMs()

    return {
      layers: [
        {
          type: 'raster',
          id: 'tri',
          name: '地形崎岖率',
          values: tri,
          style: { classes: { breaks, colors }, hillshade: 0.35 },
          legendLabels: breaks
            .map((value, index) => `${labels[index] ?? `等级 ${index + 1}`} ≤ ${round(value, 1)}`)
            .concat([`${labels[labels.length - 1]} > ${round(breaks[breaks.length - 1] ?? 0, 1)}`]),
          description: `TRI 取值 ${round(stats.min, 2)} ~ ${round(stats.max, 2)}，均值 ${round(stats.mean, 2)}。值越大说明中心像元与邻域高差越剧烈，地形越破碎。`
        },
        {
          type: 'raster',
          id: 'slope',
          name: '坡度',
          values: slopeOut,
          style: { ramp: 'thermal', vmin: 0, vmax: Math.max(1, slopeStats.p98), hillshade: 0.35 },
          legendLabels: ['0°', `${round(Math.max(1, slopeStats.p98), 1)}°`],
          description: `坡度均值 ${round(slopeStats.mean, 2)}°，与 TRI 空间格局通常正相关。`
        },
        {
          type: 'vector',
          id: 'ruggedContour',
          name: `崎岖区等值线（TRI=${threshold}）`,
          geometry: 'line',
          color: '#c1261b',
          width: 2,
          features: contours.map((path) => ({ path, attrs: { 阈值: threshold, 顶点数: path.length } })),
          legend: [{ color: '#c1261b', label: `TRI = ${threshold} m 崎岖区边界` }],
          description: `按 TRI 阈值 ${threshold} m 提取崎岖区等值线，共 ${contours.length} 条。`
        }
      ],
      defaultLayerId: 'tri',
      stats: [
        { label: '分析像元', value: `${stats.count} 个` },
        { label: 'TRI 均值', value: round(stats.mean, 2) },
        { label: 'TRI 最大', value: round(stats.max, 2) },
        { label: '崎岖区占比', value: percent(ruggedCells, stats.count) },
        { label: '平均坡度', value: `${round(slopeStats.mean, 2)}°` },
        { label: '计算方法', value: method === 'wilson' ? 'Wilson' : 'Riley' }
      ],
      timing: [
        { label: '平滑预处理', value: tSmooth - start },
        { label: 'TRI 计算', value: tTri - tSmooth },
        { label: '坡度提取', value: tSlope - tTri },
        { label: '等值线矢量化', value: tVector - tSlope }
      ],
      summary:
        '崎岖率高的区域地表起伏剧烈、沟壑与陡坎密集，通常对应山脊、深切沟谷与断层崖；平坦区 TRI 接近 0。TRI 是水土流失、滑坡与工程适宜性的重要地形指标。',
      conclusions: [
        `范围内 TRI 主要介于 ${round(stats.p2, 2)} ~ ${round(stats.p98, 2)} m，均值 ${round(stats.mean, 2)} m。`,
        `超过阈值 ${threshold} m 的崎岖区占分析面积约 ${percent(ruggedCells, stats.count)}。`,
        `平均坡度 ${round(slopeStats.mean, 2)}°，与崎岖率共同指示地形破碎程度。`
      ]
    }
  }
}
