import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-voronoi'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-voronoi',
  title: 'D3大数据-Voronoi剖分',
  category: 'd3',
  description: 'Delaunay 三角网与 Voronoi 势力范围贴地半透明渲染。',
  tag: 'Voronoi, 空间剖分',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
