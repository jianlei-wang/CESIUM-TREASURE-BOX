import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-geojson-topojson'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-geojson-topojson',
  title: 'D3大数据-GeoJSON与TopoJSON双解析',
  category: 'd3',
  description: '内联 TopoJSON 经 feature() 展开为 GeoJSON，在三维地球上渲染省/市边界并统计压缩率。',
  tag: '矢量解析, TopoJSON',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
