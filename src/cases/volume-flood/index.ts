import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const FloodVolumeDemo = defineAsyncComponent(() => import('./FloodVolumeDemo.vue'))

const floodVolumeCase: DemoCard = {
  id: 'volume-flood',
  title: '水文分析-洪水动力三维水深体',
  category: 'data',
  description:
    '河流—城市—低洼区联合洪水演进工作台：由地形、河道与洪水过程线驱动的三维水深 / 流速 / 水位体，叠加河道中心线、水文站与受影响城区，支持时间轴回放与洪峰时刻、淹没阈值与预警等值面、沿河道纵剖面、受影响对象最大水深与到达时间统计，以及任意方向剖切与 5 组相机预设。',
  tag: '水文体渲染',
  updatedAt: '2026-10-03',
  component: FloodVolumeDemo
}

export default floodVolumeCase
