import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-hull-buffer'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-hull-buffer',
  title: 'D3大数据-凸包与缓冲区',
  category: 'd3',
  description: '投影求凸包并沿顶点外扩生成包络，渲染半透明缓冲环。',
  tag: '凸包, 缓冲区',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
