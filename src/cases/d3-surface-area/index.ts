import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-surface-area'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-surface-area',
  title: 'D3大数据-三维连续曲面（面积图）',
  category: 'd3',
  description: '连续值噪声映射为规则网格四边形，四角按数值抬升着色形成三维曲面。',
  tag: '连续场, 3D曲面',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
