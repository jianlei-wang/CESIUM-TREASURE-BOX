import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-quadtree'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-quadtree',
  title: 'D3大数据-四叉树空间索引',
  category: 'd3',
  description: '递归绘制四叉树细分边界矩形，并高亮圆形范围查询命中点。',
  tag: '四叉树, 空间索引',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
