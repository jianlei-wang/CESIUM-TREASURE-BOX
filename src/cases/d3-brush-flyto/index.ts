import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-brush-flyto'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-brush-flyto',
  title: 'D3大数据-框选飞行定位',
  category: 'd3',
  description: 'd3.brush 框选屏幕矩形，反投影为经纬范围后相机自动飞行定位。',
  tag: '框选, 飞行定位',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
