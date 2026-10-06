import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-realtime-track'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-realtime-track',
  title: 'D3大数据-实时目标追踪',
  category: 'd3',
  description: '多目标平滑巡游，每帧更新位置并绘制虚线预测航迹。',
  tag: '实时追踪, 轨迹预测',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
