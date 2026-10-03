import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const OceanVolumeDemo = defineAsyncComponent(() => import('./OceanVolumeDemo.vue'))

const oceanVolumeCase: DemoCard = {
  id: 'volume-ocean',
  title: '海洋分析-温盐深三维体',
  category: 'data',
  description:
    '黄海陆架温盐深三维结构工作台：温度 / 盐度 / 密度随深度的层化结构叠加海流粒子，支持多变量切换、季节演变、深度分层浏览、等值面、垂向层结剖面、温盐（T-S）散点与水团判别，以及温跃层深度、极值与均值统计、观测站位定位和任意方向剖切。',
  tag: '海洋体渲染',
  updatedAt: '2026-10-03',
  component: OceanVolumeDemo
}

export default oceanVolumeCase
