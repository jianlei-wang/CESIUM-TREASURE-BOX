import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-tile-grid-map'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-tile-grid-map',
  title: 'D3大数据-瓦片格网地图',
  category: 'd3',
  description: '区域单元排成规则瓦片网格并拉伸为 3D 色块，按数值着色、保留相对地理位置。',
  tag: '网格地图, tile grid',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
