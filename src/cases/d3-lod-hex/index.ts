import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-lod-hex'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-lod-hex',
  title: 'D3大数据-多尺度LOD蜂窝',
  category: 'd3',
  description: '随相机高度自动切换 H3 分辨率并重建蜂窝聚合，实现统计粒度的多尺度 LOD。',
  tag: 'H3, LOD',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
