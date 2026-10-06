import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-heat-field'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-heat-field',
  title: 'D3大数据-三维热力场等值面',
  category: 'd3',
  description: '用二维噪声生成密度场，经 d3.contours 按多阈值切成贴地渲染的填充等值面。',
  tag: '等值线, 热力场',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
