import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-flow-arc'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-flow-arc',
  title: 'D3大数据-全球流量流向弧线图',
  category: 'd3',
  description: '沿球面插值生成流动弧线，以颜色、线宽与光点编码方向与强度。',
  tag: '流向弧线, 全球流',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
