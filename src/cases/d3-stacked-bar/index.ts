import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-stacked-bar'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-stacked-bar',
  title: 'D3大数据-三维堆叠柱状图',
  category: 'd3',
  description: 'd3.stack 分层累计多指标，逐层生成方块底座与高度，支持堆叠/分组切换。',
  tag: '统计图形, 堆叠柱',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
