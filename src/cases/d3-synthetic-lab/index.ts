import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-synthetic-lab'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-synthetic-lab',
  title: 'D3大数据-合成数据实验室性能压测',
  category: 'd3',
  description: '唯一使用随机数据的压测入口：生成 1 万 – 1000 万合成点，测试点渲染、H3 / Hexbin / Grid 聚合与 Worker 的极限表现，界面明确标注为合成数据。',
  tag: 'Synthetic, 压测, TypedArray',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
