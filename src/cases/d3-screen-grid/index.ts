import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-screen-grid'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-screen-grid',
  title: 'D3大数据-动态屏幕网格像素尺度聚合',
  category: 'd3',
  description: '真实事件投影到屏幕空间后做像素级网格聚合，并用 Quadtree 支持最近邻高亮，实现随视口变化的动态聚合。',
  tag: 'Screen Grid, Quadtree, 像素尺度',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
