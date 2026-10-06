import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-temporal-heat'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-temporal-heat',
  title: 'D3大数据-时序热力播放',
  category: 'd3',
  description: '点位按小时聚合到网格，逐帧播放一天 24 小时的热度起伏。',
  tag: '时序热度, 动态播放',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
