import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-scale-styling'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-scale-styling',
  title: 'D3大数据-尺度驱动样式映射',
  category: 'd3',
  description: '用线性/对数/量化尺度把规则格网数值映射为色带与柱高，直观展示数据即样式。',
  tag: '比例尺, 视觉编码',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
