import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-hexbin-decimate'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-hexbin-decimate',
  title: 'D3大数据-蜂窝抽稀与点降采样',
  category: 'd3',
  description: '十万级散点在蜂窝聚合与原始点模式间切换，实时对比数据压减率。',
  tag: 'hexbin, 降采样',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
