import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-bubble-globe'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-bubble-globe',
  title: 'D3大数据-三维气泡图',
  category: 'd3',
  description: '以 scaleSqrt 映射气泡半径、scaleSequential 映射颜色，在三维地球上表达城市体量。',
  tag: '统计图形, 气泡',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
