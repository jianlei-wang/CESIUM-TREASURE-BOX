import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-minimap'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-minimap',
  title: 'D3大数据-双视图联动小地图',
  category: 'd3',
  description: 'd3.geoPath 小地图同步主视图范围框，点击小地图快速移动相机。',
  tag: '小地图, 双视图联动',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
