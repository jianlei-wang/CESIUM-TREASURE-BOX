import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-hexbin'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-hexbin',
  title: 'D3大数据-六边形格网聚合',
  category: 'd3',
  description: '海量散点聚合到规则蜂窝格网，计数映射六棱柱高度与颜色。',
  tag: 'hexbin, 空间聚合',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
