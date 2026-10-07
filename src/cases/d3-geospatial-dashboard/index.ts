import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-geospatial-dashboard'
import icon from './icon.webp'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-geospatial-dashboard',
  title: 'D3大数据-地理大数据综合指挥舱',
  category: 'd3',
  icon,
  description: '点云、H3 聚合、OD 流量与时间窗口多图层联动，配合指标面板，综合展示 D3 地理大数据分析能力。',
  tag: 'Dashboard, 综合, 多图层',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
