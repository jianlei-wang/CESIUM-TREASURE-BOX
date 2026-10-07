import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-mvt-bigdata'
import icon from './icon.webp'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-mvt-bigdata',
  title: 'D3大数据-MVT矢量瓦片大数据',
  category: 'd3',
  description: '真实边界要素按 z/x/y 切片，自实现 MVT PBF 编解码并回传几何，配合 LOD 在 Cesium 中以 Primitive 渲染矢量瓦片。',
  tag: 'MVT, PBF, Vector Tile, LOD',
  icon,
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
