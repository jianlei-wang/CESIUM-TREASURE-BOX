import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-path-portions'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-path-portions',
  title: 'D3大数据-分段轨迹材质',
  category: 'd3',
  description: '按速度阈值把轨迹切成多段，快段红色、慢段蓝色分别渲染并配图例。',
  tag: '轨迹分段, 状态着色',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
