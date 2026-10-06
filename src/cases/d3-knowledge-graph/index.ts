import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-knowledge-graph'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-knowledge-graph',
  title: 'D3大数据-知识图谱地理叠加',
  category: 'd3',
  description: '四类知识实体锚定真实经纬位置，用颜色与弧线表达类型和语义关系。',
  tag: '图数据, 关系网络',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
