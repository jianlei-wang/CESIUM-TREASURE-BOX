import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-delaunay-voronoi'
import icon from './icon.webp'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-delaunay-voronoi',
  title: 'D3大数据-Delaunay与Voronoi邻域分析',
  category: 'd3',
  icon,
  description: '真实城市点构建 Delaunay 三角网与 Voronoi 影响范围，结合最近邻查询，展示空间邻域分析的地理可视化。',
  tag: 'Delaunay, Voronoi, 最近邻',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
