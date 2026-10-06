import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-local-moran'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-local-moran',
  title: 'D3大数据-局部空间自相关',
  category: 'd3',
  description: '格网偏离与邻域均值组合，划分高-高、低-低与两类空间离群，生成局部聚类显著图。',
  tag: '局部空间自相关, Moran',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
