import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-treemap'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-treemap',
  title: 'D3大数据-三维矩形树图',
  category: 'd3',
  description: '层级数据按数值切分为矩形并映射为地图上的拉伸地块，面积与高度双重编码。',
  tag: '层级布局, treemap',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
