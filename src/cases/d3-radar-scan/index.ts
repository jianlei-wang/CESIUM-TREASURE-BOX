import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-radar-scan'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-radar-scan',
  title: 'D3大数据-雷达扫描特效',
  category: 'd3',
  description: '扩散圆环叠加旋转扫描线，扫描掠过目标点时实时高亮命中。',
  tag: '雷达扫描, 动效',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
