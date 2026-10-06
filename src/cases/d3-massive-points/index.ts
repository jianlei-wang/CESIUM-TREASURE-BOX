import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-massive-points'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-massive-points',
  title: 'D3大数据-百万级地理散点GPU可视化',
  category: 'd3',
  description: 'Typography 列式 Float32Array 承载百万级地理点，按相机高度 LOD 抽稀，PointPrimitiveCollection 单批 GPU 绘制，实时回显渲染对象数与帧率。',
  tag: '百万点, GPU, LOD',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
