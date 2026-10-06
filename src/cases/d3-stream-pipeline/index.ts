import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-stream-pipeline'

const StreamPipelineDemo = createD3Case(spec)

const d3StreamPipelineCase: DemoCard = {
  id: 'd3-stream-pipeline',
  title: 'D3大数据-流式接入与清洗管线',
  category: 'd3',
  description: 'd3-fetch / group / rollup 在浏览器内完成去重、清洗与聚合，再分批写入 Cesium 实体集合。',
  tag: '数据接入, 清洗, 聚合',
  component: StreamPipelineDemo,
  updatedAt: '2026-10-06'
}

export default d3StreamPipelineCase
