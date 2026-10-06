import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-hex-growth'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-hex-growth',
  title: 'D3大数据-蜂窝时序生长',
  category: 'd3',
  description: '由中心向外分配生长延迟，逐柱缓动拔高，表现人口与区域增长的时间过程。',
  tag: 'hexbin, 生长动画',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
