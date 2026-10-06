import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-bar-globe'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-bar-globe',
  title: 'D3大数据-三维棱柱柱状图',
  category: 'd3',
  description: 'd3 比例尺映射柱高与颜色，在三维地球上形成可旋转的 Bar Globe。',
  tag: '统计图形, 3D柱状',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
