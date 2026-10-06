import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-time-brush'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-time-brush',
  title: 'D3大数据-时间刷联动过滤',
  category: 'd3',
  description: 'SVG 时间轴框选时间区间，实时过滤三维事件点与统计。',
  tag: '时间刷, 联动过滤',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
