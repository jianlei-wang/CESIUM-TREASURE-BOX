import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-vector-terrain'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-vector-terrain',
  title: 'D3大数据-矢量数据贴地形渲染',
  category: 'd3',
  description: '道路、河流与普查区矢量要素贴合真实地形，验证 1.144 贴地形能力。',
  tag: '矢量贴地形, clampToGround',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
