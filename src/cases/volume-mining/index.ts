import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const MiningVolumeDemo = defineAsyncComponent(() => import('./MiningVolumeDemo.vue'))

const miningVolumeCase: DemoCard = {
  id: 'volume-mining',
  title: '矿山分析-三维矿体品位体',
  category: 'data',
  description:
    '露天矿三维矿体品位工作台：以钻孔样品经反距离加权（IDW）插值构建 Cu / Au / Fe 品位体，支持成矿元素切换、边界品位与工业品位阈值、矿体等值面、勘探线品位剖面与品位分布直方图，叠加钻孔轨迹与采坑台阶，并按块体模型统计矿石量、吨位、平均品位与金属量，配套 5 组相机预设与任意方向剖切。',
  tag: '矿山体渲染',
  updatedAt: '2026-10-03',
  component: MiningVolumeDemo
}

export default miningVolumeCase
