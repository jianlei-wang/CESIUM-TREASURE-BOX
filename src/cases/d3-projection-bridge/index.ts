import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-projection-bridge'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-projection-bridge',
  title: 'D3大数据-2D与3D投影坐标桥接',
  category: 'd3',
  description: '同一组经纬度分别经 d3.geoPath 投影与 Cesium 上球渲染，用浮层 SVG 验证两者一致。',
  tag: '投影, 坐标桥接',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
