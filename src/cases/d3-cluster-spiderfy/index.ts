import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-cluster-spiderfy'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-cluster-spiderfy',
  title: 'D3大数据-聚合气泡簇与爆炸展开',
  category: 'd3',
  description: '先按距离阈值聚合成气泡簇，点击圆圈用扇形 spiderfy 展开内部子点。',
  tag: '聚类, spiderfy',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
