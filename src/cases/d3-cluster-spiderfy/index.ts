import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-cluster-spiderfy'
import icon from './icon.webp'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-cluster-spiderfy',
  title: 'D3大数据-聚类气泡簇与爆炸展开',
  category: 'd3',
  icon,
  description: '真实事件在屏幕网格中聚类为气泡簇，点击圆圈自动缩放并按发震时刻展开成员，进入震群序列分析：颜色映射时序、大小映射震级、主震高亮，配合震级—时间曲线面板。',
  tag: 'Cluster, Spiderfy, 屏幕空间',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
