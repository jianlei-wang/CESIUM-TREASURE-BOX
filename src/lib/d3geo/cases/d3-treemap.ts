import { hierarchy, treemap, treemapSquarify, treemapBinary } from 'd3'
import type { D3CaseSpec } from '../types'
import { categorical } from '../palettes'
import { addLabel, addPolygon } from '../render'

type TreeDatum = { name: string; value?: number; children?: TreeDatum[] }

const DATA: TreeDatum = {
  name: '地理数据资产',
  children: [
    {
      name: '遥感影像',
      children: [
        { name: '高分光学', value: 42 },
        { name: '合成孔径雷达', value: 30 },
        { name: '高光谱', value: 24 },
        { name: '热红外', value: 16 },
        { name: '夜光遥感', value: 12 }
      ]
    },
    {
      name: '矢量地图',
      children: [
        { name: '行政区划', value: 28 },
        { name: '路网', value: 34 },
        { name: '水系', value: 20 },
        { name: '兴趣点', value: 26 },
        { name: '建筑轮廓', value: 22 }
      ]
    },
    {
      name: '三维模型',
      children: [
        { name: '城市白模', value: 30 },
        { name: '倾斜摄影', value: 36 },
        { name: '点云', value: 18 },
        { name: 'BIM', value: 14 }
      ]
    },
    {
      name: '专题统计',
      children: [
        { name: '人口格网', value: 24 },
        { name: '经济指标', value: 20 },
        { name: '气候要素', value: 16 },
        { name: '灾害风险', value: 12 }
      ]
    }
  ]
}

const BOUNDS = { west: 102, south: 22, east: 124, north: 42 }

const CATEGORY_INDEX = new Map<string, number>(
  (DATA.children ?? []).map((child, index): [string, number] => [child.name, index])
)

type Leaf = {
  x0: number
  y0: number
  x1: number
  y1: number
  value: number
  parent?: { data: { name: string } } | null
}

const spec: D3CaseSpec = {
  id: 'd3-treemap',
  meta: {
    title: '三维矩形树图',
    subtitle: 'd3.hierarchy + d3.treemap → 拉伸地块',
    description: '按数值把数据资产递归切分为矩形，再映射到地图上的彩色拉伸地块，面积与高度双重编码。',
    tag: 'D3 层级布局 · treemap',
    accent: '#a78bfa',
    tips: [
      'd3.treemap 的 squarify / binary 切片算法把层级数据铺满单位正方形',
      '矩形坐标线性映射到经纬范围，每个叶子生成一个拉伸多边形地块',
      '地块面积与高度均随数值增长，颜色按父层级分类，兼顾结构可读性'
    ]
  },
  defaults: {
    layout: 'squarify',
    heightScale: 260000,
    baseHeight: 20000,
    padding: 0.012,
    showLabels: true
  },
  camera: { lon: 113, lat: 32, height: 2800000, pitch: -82 },
  controls: [
    {
      kind: 'select',
      key: 'layout',
      label: '切分算法',
      options: [
        { value: 'squarify', label: 'squarify 正方形化' },
        { value: 'binary', label: 'binary 二分法' }
      ]
    },
    { kind: 'range', key: 'heightScale', label: '高度倍率', min: 20000, max: 600000, step: 10000 },
    { kind: 'range', key: 'baseHeight', label: '基准高度', min: 0, max: 100000, step: 5000 },
    { kind: 'range', key: 'padding', label: '块间隙', min: 0, max: 0.05, step: 0.002 },
    { kind: 'checkbox', key: 'showLabels', label: '显示分类标签' }
  ],
  setup(ctx) {
    const layout = String(ctx.settings.layout)
    const heightScale = Number(ctx.settings.heightScale)
    const baseHeight = Number(ctx.settings.baseHeight)
    const padding = Number(ctx.settings.padding)
    const showLabels = Boolean(ctx.settings.showLabels)

    const root = hierarchy(DATA)
      .sum((d: TreeDatum) => d.value ?? 0)
      .sort((a: { value?: number }, b: { value?: number }) => (b.value ?? 0) - (a.value ?? 0))

    const tile = layout === 'binary' ? treemapBinary : treemapSquarify
    treemap()
      .size([1, 1])
      .paddingInner(padding)
      .paddingOuter(padding * 0.5)
      .tile(tile)(root)

    const leaves = root.leaves() as unknown as Leaf[]
    const maxValue = Math.max(...leaves.map((leaf) => leaf.value))

    const lonSpan = BOUNDS.east - BOUNDS.west
    const latSpan = BOUNDS.north - BOUNDS.south
    const groupings = new Map<string, { sumX: number; sumY: number; count: number }>()

    leaves.forEach((leaf) => {
      const west = BOUNDS.west + leaf.x0 * lonSpan
      const east = BOUNDS.west + leaf.x1 * lonSpan
      const north = BOUNDS.north - leaf.y0 * latSpan
      const south = BOUNDS.north - leaf.y1 * latSpan
      const parentName = leaf.parent?.data.name ?? '其他'
      const color = categorical(CATEGORY_INDEX.get(parentName) ?? 0)
      const valueRatio = maxValue === 0 ? 0 : leaf.value / maxValue
      const top = baseHeight + valueRatio * heightScale

      addPolygon(
        ctx.dataSource,
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north]
        ],
        {
          height: baseHeight,
          extrudedHeight: top,
          color,
          alpha: 0.88,
          outline: true,
          outlineColor: '#0f172a',
          outlineWidth: 1
        }
      )

      const stat = groupings.get(parentName) ?? { sumX: 0, sumY: 0, count: 0 }
      stat.sumX += (west + east) / 2
      stat.sumY += (south + north) / 2
      stat.count += 1
      groupings.set(parentName, stat)
    })

    if (showLabels) {
      groupings.forEach((stat, name) => {
        addLabel(ctx.dataSource, stat.sumX / stat.count, stat.sumY / stat.count, name, {
          font: '12px sans-serif',
          color: '#f8fafc',
          scaleByDistance: [600000, 0.4, 4000000, 1.3],
          disableDepthTest: true
        })
      })
    }

    ctx.legend(
      [...CATEGORY_INDEX.keys()].map((name, index) => ({ label: name, color: categorical(index) }))
    )
    ctx.status(`treemap(${layout})：${(DATA.children ?? []).length} 个分类，${leaves.length} 个叶节点`)
  }
}

export default spec
