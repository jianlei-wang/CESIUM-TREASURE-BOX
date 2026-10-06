import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-force-network'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-force-network',
  title: 'D3大数据-全球网络拓扑图',
  category: 'd3',
  description: '力导向模拟在经纬平面自组织全球枢纽拓扑，逐帧推进演化。',
  tag: '力学布局, 网络拓扑',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
