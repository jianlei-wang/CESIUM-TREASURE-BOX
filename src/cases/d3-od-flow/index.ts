import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-od-flow'
import icon from './icon.webp'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-od-flow',
  title: 'D3大数据-全球OD流量网络真实航线',
  category: 'd3',
  icon,
  description: '以 OpenFlights routes.dat 真实航线构建 OD 矩阵，经 d3 统计聚合后生成抬升弧线，直观呈现全球航空流量网络。',
  tag: 'OD, Flow Arc, 网络分析',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
