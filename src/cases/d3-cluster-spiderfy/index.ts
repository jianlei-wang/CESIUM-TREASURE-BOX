import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-cluster-spiderfy'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-cluster-spiderfy',
  title: 'D3大数据-聚类气泡簇与爆炸展开',
  category: 'd3',
  description: '真实事件在屏幕网格中聚类为气泡簇，点击圆圈用扇形 spiderfy 展开内部成员，兼顾宏观分布与个体定位。',
  tag: 'Cluster, Spiderfy, 屏幕空间',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
