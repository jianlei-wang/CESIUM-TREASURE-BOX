import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const FireVolumeDemo = defineAsyncComponent(() => import('./FireVolumeDemo.vue'))

const fireVolumeCase: DemoCard = {
  id: 'volume-fire',
  title: '灾害分析-火灾烟气与温度三维体',
  category: 'data',
  description:
    '城市建筑火灾态势研判工作台：多火源随时间的成长与浮升烟羽在环境风驱动下向下风向输运，生成三维温度 / 烟气 / 能见度场，叠加火源、周边建筑受威胁着色、环境风箭头与疏散方向，支持时间轴回放、风速风向重建、危险温度与烟气阈值等值面、火源垂向剖面、危险体积 / 烟羽顶高 / 下风向影响距离统计与垂直剖切。',
  tag: '灾害体渲染',
  updatedAt: '2026-10-03',
  component: FireVolumeDemo
}

export default fireVolumeCase
