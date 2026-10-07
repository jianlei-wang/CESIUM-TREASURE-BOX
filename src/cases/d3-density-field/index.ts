import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-density-field'
import icon from './icon.webp'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-density-field',
  title: 'D3大数据-动态热力场KDE连续密度',
  category: 'd3',
  icon,
  description: '真实地震点经核密度估计生成连续场，叠加贴地面场、等值线与峰值标注，展示从离散点到连续密度的 d3 分析链路。',
  tag: 'KDE, 连续场, d3.contours',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
