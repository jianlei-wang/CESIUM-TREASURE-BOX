import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-clamped-hex'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-clamped-hex',
  title: 'D3大数据-地形贴合蜂窝',
  category: 'd3',
  description: '用 globe.getHeight 逐顶点采样地形，使蜂窝多边形沿地表起伏并向上抬升成柱。',
  tag: '地形贴合, perPositionHeight',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
