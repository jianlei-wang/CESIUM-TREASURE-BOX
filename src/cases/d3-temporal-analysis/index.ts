import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-temporal-analysis'
import icon from './icon.webp'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-temporal-analysis',
  title: 'D3大数据-时空统计分析时间轴与异常',
  category: 'd3',
  description: '真实地震序列按时间分箱，叠加移动平均、分位数带与异常点检测，地图与时间轴双向联动。',
  tag: 'Temporal, d3.bin, 异常检测',
  icon,
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
