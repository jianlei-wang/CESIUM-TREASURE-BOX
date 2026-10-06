import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-trajectory'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-trajectory',
  title: 'D3大数据-时空轨迹回放',
  category: 'd3',
  description: '带速度变化的采样轨迹沿完整航线回放，并用渐隐尾迹还原运动过程。',
  tag: '时空数据, 轨迹回放',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
