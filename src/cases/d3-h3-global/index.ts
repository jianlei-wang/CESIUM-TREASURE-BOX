import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-h3-global'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-h3-global',
  title: 'D3大数据-H3全球六边形网格',
  category: 'd3',
  description: 'H3 六边形网格覆盖区域，随机点按单元聚合，计数映射柱高与颜色。',
  tag: 'H3, 六边形网格',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
