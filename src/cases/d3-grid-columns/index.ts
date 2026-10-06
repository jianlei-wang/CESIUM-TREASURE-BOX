import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-grid-columns'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-grid-columns',
  title: 'D3大数据-方形格网3D柱',
  category: 'd3',
  description: '随机点聚合到规则方形格网，每格用立柱表达计数，高度与颜色双编码。',
  tag: 'gridbin, 格网聚合',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
