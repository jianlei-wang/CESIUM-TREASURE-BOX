import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-trajectories'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-trajectories',
  title: 'D3大数据-时空轨迹大数据时间轴联动',
  category: 'd3',
  description: '真实事件序列按时间窗口聚合成区域迁移轨迹，时间轴与地图联动播放，展示 d3 时间尺度与时空轨迹分析。',
  tag: 'Trajectory, d3.scaleTime, 时空',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
