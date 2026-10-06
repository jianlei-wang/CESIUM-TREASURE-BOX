import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-sankey'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-sankey',
  title: 'D3大数据-桑基流带地理化',
  category: 'd3',
  description: '东部到西部的分组流量绘制为变宽地理流带，带宽编码流量强度。',
  tag: '流向分析, 桑基流带',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
