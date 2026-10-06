import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-od-grid'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-od-grid',
  title: 'D3大数据-流向格网',
  category: 'd3',
  description: '把 OD 起终点聚合到格网，在格内绘制方向与强度共同编码的主导流向箭头。',
  tag: 'OD聚合, 流向箭头',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
