import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-floating-chart'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-floating-chart',
  title: 'D3大数据-悬浮图表联动面板',
  category: 'd3',
  description: '屏幕浮层叠加 d3 折线/柱状面板，点击地图城市切换对应时间序列。',
  tag: '屏幕浮层, 图表联动',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
