import type { CaseProfile } from '../terrain-analysis-lib/workbench-types'
import { paramNumber, paramString } from '../terrain-analysis-lib/workbench-types'
import { cellSizeMeters, focalMean } from '../terrain-analysis-lib/hydrology'
import { classBreaks, gridStats, slopeAspectGrids } from '../terrain-analysis-lib/palette'
import { demTransform, marchingSquaresContours } from '../terrain-analysis-lib/vectorize'
import { nowMs, percent, round } from '../terrain-analysis-lib/util'

const ROUGH_PALETTES: Record<string, string[]> = {
  '4': ['#143d64', '#3aa6a6', '#f2d43d', '#c1261b'],
  '5': ['#143d64', '#3aa6a6', '#f2d43d', '#e07a2f', '#c1261b'],
  '6': ['#143d64', '#2a7f9e', '#5ebf9a', '#f2d43d', '#e07a2f', '#c1261b']
}

const ROUGH_LABELS: Record<string, string[]> = {
  '4': ['平滑', '较平缓', '较粗糙', '极粗糙'],
  '5': ['平滑', '较平缓', '中等', '较粗糙', '极粗糙'],
  '6': ['平滑', '平缓', '较平缓', '较粗糙', '粗糙', '极粗糙']
}

export const roughnessProfile: CaseProfile = {
  id: 'terrain-roughness',
  title: '地形粗糙度分析',
  reportTitle: '地形粗糙度空间分析报告',
  fileNamePrefix: 'roughness',
  intro:
    '地形粗糙度刻画地表局部起伏幅度与表面积膨胀程度，常用邻域高差（max−min）或地表面积与投影面积之比度量，是土壤侵蚀、径流与工程选址的重要指标。',
  summaryTitle: '地形粗糙度结果',
  route: {
    title: '地形粗糙度技术路线',
    intro: '对 DEM 可选平滑后，用邻域极差法或三角网表面积比值法逐像元计算粗糙度，再分级设色并提取粗糙区等值线。',
    steps: [
      { title: '1. 数据预处理', text: '按需做焦点均值平滑，削弱 DEM 噪声，使粗糙度反映真实地形起伏。' },
      { title: '2. 邻域极差法', text: '在 (2r+1) 窗口内取最大与最小高程之差，得到局部起伏度，直观反映地表相对高差。' },
      { title: '3. 表面积比值法', text: '以像元 2×2 角点构造三角网，计算三维表面积与投影面积之比，比值越大说明表面越破碎。' },
      { title: '4. 分级设色', text: '采用分位数法将粗糙度分级，从平滑到极粗糙依次设色。' },
      { title: '5. 粗糙区提取', text: '按阈值提取粗糙区等值线，圈定地表破碎、易侵蚀的地带。' },
      { title: '6. 成果输出', text: '粗糙度栅格导出 GeoTIFF，等值线导出 SHP/GeoJSON，并生成在线报告与 PDF。' }
    ]
  },
  params: [
    {
      key: 'method',
      label: '计算方法',
      kind: 'select',
      hint: '邻域极差法计算窗口内最大最小高程差；表面积比值法用三角网面积与投影面积之比度量破碎度。',
      default: 'relief',
      options: [
        { label: '邻域极差（max−min）', value: 'relief' },
        { label: '表面积比值', value: 'ratio' }
      ]
    },
    {
      key: 'radius',
      label: '邻域半径',
      kind: 'slider',
      hint: '极差法的窗口半径（像元），半径越大越强调宏观起伏，越小越强调微观粗糙。',
      default: 1,
      min: 1,
      max: 5,
      step: 1,
      unit: 'px'
    },
    {
      key: 'smoothWindow',
      label: '平滑窗口',
      kind: 'slider',
      hint: '计算前的均值平滑窗口（奇数像元），用于抑制噪声。',
      default: 1,
      min: 1,
      max: 9,
      step: 2,
      unit: 'px'
    },
    {
      key: 'classCount',
      label: '分级数量',
      kind: 'select',
      hint: '粗糙度分级设色的等级数量。',
      default: '5',
      options: [
        { label: '4 级', value: '4' },
        { label: '5 级', value: '5' },
        { label: '6 级', value: '6' }
      ]
    },
    {
      key: 'reliefThreshold',
      label: '极差阈值（m）',
      kind: 'slider',
      hint: '极差法下判定粗糙区的起伏度阈值（米）。',
      default: 30,
      min: 2,
      max: 200,
      step: 2,
      unit: 'm'
    },
    {
      key: 'ratioThreshold',
      label: '比值阈值（×）',
      kind: 'slider',
      hint: '表面积比值法下判定粗糙区的表面积膨胀倍率，越大越严格。',
      default: 1.3,
      min: 1.02,
      max: 2,
      step: 0.02,
      unit: '×'
    },
    {
      key: 'contourMinLength',
      label: '等值线最小长度',
      kind: 'slider',
      hint: '过滤短小等值线，仅保留主要粗糙区边界。',
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
    const method = paramString(params, 'method', 'relief')
    const radius = Math.max(1, Math.round(paramNumber(params, 'radius', 1)))
    const smoothWindow = Math.max(1, Math.round(paramNumber(params, 'smoothWindow', 1)))
    const classCount = Number(paramString(params, 'classCount', '5'))
    const reliefThreshold = paramNumber(params, 'reliefThreshold', 30)
    const ratioThreshold = paramNumber(params, 'ratioThreshold', 1.3)
    const contourMinLength = paramNumber(params, 'contourMinLength', 6)
    const contourSmooth = paramNumber(params, 'contourSmooth', 0.8)

    const base = smoothWindow > 1 ? focalMean(dem.values, width, height, smoothWindow) : dem.values
    const tSmooth = nowMs()
    const n = width * height
    const roughness = new Float32Array(n)
    const { cellX, cellY } = cellSizeMeters(dem.west, dem.east, dem.south, dem.north, width, height)

    if (method === 'ratio') {
      const planar = cellX * cellY
      for (let r = 0; r < height - 1; r += 1) {
        for (let c = 0; c < width - 1; c += 1) {
          const tl = base[r * width + c]
          const tr = base[r * width + c + 1]
          const bl = base[(r + 1) * width + c]
          const br = base[(r + 1) * width + c + 1]
          const centerRow = r + 0.5
          const centerCol = c + 0.5
          const ri = Math.min(height - 1, Math.round(centerRow))
          const ci = Math.min(width - 1, Math.round(centerCol))
          const idx = ri * width + ci
          if (!mask[idx] || !Number.isFinite(tl) || !Number.isFinite(tr) || !Number.isFinite(bl) || !Number.isFinite(br)) {
            if (mask[idx]) roughness[idx] = Number.NaN
            continue
          }
          const a1 = triangleArea(c, r, tl, c + 1, r, tr, c, r + 1, bl, cellX, cellY)
          const a2 = triangleArea(c + 1, r, tr, c + 1, r + 1, br, c, r + 1, bl, cellX, cellY)
          roughness[idx] = (a1 + a2) / planar
        }
      }
      for (let i = 0; i < n; i += 1) if (!mask[i]) roughness[i] = Number.NaN
    } else {
      for (let r = 0; r < height; r += 1) {
        for (let c = 0; c < width; c += 1) {
          const i = r * width + c
          if (!mask[i] || !Number.isFinite(base[i])) {
            roughness[i] = Number.NaN
            continue
          }
          let minV = Number.POSITIVE_INFINITY
          let maxV = Number.NEGATIVE_INFINITY
          for (let dr = -radius; dr <= radius; dr += 1) {
            const nr = r + dr
            if (nr < 0 || nr >= height) continue
            for (let dc = -radius; dc <= radius; dc += 1) {
              const nc = c + dc
              if (nc < 0 || nc >= width) continue
              const v = base[nr * width + nc]
              if (!Number.isFinite(v)) continue
              if (v < minV) minV = v
              if (v > maxV) maxV = v
            }
          }
          roughness[i] = Number.isFinite(minV) ? maxV - minV : Number.NaN
        }
      }
    }
    const tRough = nowMs()

    const { slopeDeg } = slopeAspectGrids(dem)
    const slopeOut = new Float32Array(n)
    for (let i = 0; i < n; i += 1) slopeOut[i] = mask[i] ? slopeDeg[i] : Number.NaN
    const tSlope = nowMs()

    const stats = gridStats(roughness)
    const slopeStats = gridStats(slopeOut)
    const breaks = classBreaks(roughness, 'quantile', classCount)
    const colors = ROUGH_PALETTES[String(classCount)] ?? ROUGH_PALETTES['5']
    const labels = ROUGH_LABELS[String(classCount)] ?? ROUGH_LABELS['5']
    const threshold = method === 'ratio' ? ratioThreshold : reliefThreshold
    const unitText = method === 'ratio' ? '×' : 'm'

    let roughCells = 0
    for (let i = 0; i < n; i += 1) if (Number.isFinite(roughness[i]) && roughness[i] > threshold) roughCells += 1

    const contours = marchingSquaresContours(roughness, width, height, threshold, {
      transform: demTransform(dem),
      minLengthPx: contourMinLength,
      simplifyTolerance: contourSmooth
    })
    const tVector = nowMs()

    return {
      layers: [
        {
          type: 'raster',
          id: 'roughness',
          name: '地形粗糙度',
          values: roughness,
          style: { classes: { breaks, colors }, hillshade: 0.35 },
          legendLabels: breaks
            .map((value, index) => `${labels[index] ?? `等级 ${index + 1}`} ≤ ${round(value, 2)}`)
            .concat([`${labels[labels.length - 1]} > ${round(breaks[breaks.length - 1] ?? 0, 2)}`]),
          description: `粗糙度取值 ${round(stats.min, 2)} ~ ${round(stats.max, 2)}，均值 ${round(stats.mean, 2)}（${method === 'ratio' ? '表面积比值' : '邻域极差'}）。`
        },
        {
          type: 'raster',
          id: 'slope',
          name: '坡度',
          values: slopeOut,
          style: { ramp: 'thermal', vmin: 0, vmax: Math.max(1, slopeStats.p98), hillshade: 0.35 },
          legendLabels: ['0°', `${round(Math.max(1, slopeStats.p98), 1)}°`],
          description: `坡度均值 ${round(slopeStats.mean, 2)}°，与粗糙度共同表征地表破碎程度。`
        },
        {
          type: 'vector',
          id: 'roughContour',
          name: `粗糙区等值线（${round(threshold, 2)}${unitText}）`,
          geometry: 'line',
          color: '#c1261b',
          width: 2,
          features: contours.map((path) => ({ path, attrs: { 阈值: threshold, 单位: unitText, 顶点数: path.length } })),
          legend: [{ color: '#c1261b', label: `粗糙度 = ${round(threshold, 2)}${unitText} 边界` }],
          description: `按阈值 ${round(threshold, 2)}${unitText} 提取粗糙区等值线，共 ${contours.length} 条。`
        }
      ],
      defaultLayerId: 'roughness',
      stats: [
        { label: '分析像元', value: `${stats.count} 个` },
        { label: '粗糙度均值', value: round(stats.mean, 2) },
        { label: '粗糙度最大', value: round(stats.max, 2) },
        { label: '粗糙区占比', value: percent(roughCells, stats.count) },
        { label: '平均坡度', value: `${round(slopeStats.mean, 2)}°` },
        { label: '度量方法', value: method === 'ratio' ? '表面积比值' : '邻域极差' }
      ],
      timing: [
        { label: '平滑预处理', value: tSmooth - start },
        { label: '粗糙度计算', value: tRough - tSmooth },
        { label: '坡度提取', value: tSlope - tRough },
        { label: '等值线矢量化', value: tVector - tSlope }
      ],
      summary:
        '粗糙度高的区域地表起伏剧烈、沟壑与碎石密集，易发生水土流失与径流集中；粗糙度低的区域地表平缓，适宜耕作与建设。',
      conclusions: [
        `范围内粗糙度主要介于 ${round(stats.p2, 2)} ~ ${round(stats.p98, 2)}，均值 ${round(stats.mean, 2)}。`,
        `超过阈值 ${round(threshold, 2)}${unitText} 的粗糙区占分析面积约 ${percent(roughCells, stats.count)}。`,
        `平均坡度 ${round(slopeStats.mean, 2)}°，地表破碎区多与陡坡、沟谷带重合。`
      ]
    }
  }
}

function triangleArea(
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  x3: number,
  y3: number,
  z3: number,
  cellX: number,
  cellY: number
): number {
  const ax = (x2 - x1) * cellX
  const ay = (y2 - y1) * cellY
  const az = z2 - z1
  const bx = (x3 - x1) * cellX
  const by = (y3 - y1) * cellY
  const bz = z3 - z1
  const cx = ay * bz - az * by
  const cy = az * bx - ax * bz
  const cz = ax * by - ay * bx
  return 0.5 * Math.hypot(cx, cy, cz)
}
