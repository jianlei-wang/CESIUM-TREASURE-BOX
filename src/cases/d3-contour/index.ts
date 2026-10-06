import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-contour'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-contour',
  title: 'D3大数据-等值线等值面',
  category: 'd3',
  description: '值噪声生成连续场，按多级阈值切出等值面并叠加等值线边框。',
  tag: '等值线, 标量场',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
