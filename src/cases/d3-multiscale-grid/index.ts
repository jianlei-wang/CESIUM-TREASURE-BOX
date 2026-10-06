import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-multiscale-grid'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-multiscale-grid',
  title: 'D3大数据-多尺度H3与Hexbin聚合',
  category: 'd3',
  description: '相机高度映射 H3 / Hexbin 分辨率，聚合计算下沉 Worker，结果以聚合单元 Primitive 渲染，兼顾宏观密度与细节。',
  tag: 'H3, Hexbin, LOD, Worker',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
