import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-pie-map'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-pie-map',
  title: 'D3大数据-地理环形图组合',
  category: 'd3',
  description: 'd3.pie 计算产业占比角度，在局部平面生成扇形顶点并拉伸成悬浮甜甜圈。',
  tag: '饼图, 空间组合',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
