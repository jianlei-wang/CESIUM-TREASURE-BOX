import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-idw-surface'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-idw-surface',
  title: 'D3大数据-IDW连续曲面',
  category: 'd3',
  description: '反距离加权插值把观测点铺成规则格网，用带高度的四边形拼出连续曲面。',
  tag: 'IDW, 曲面插值',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
