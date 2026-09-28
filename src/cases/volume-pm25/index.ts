import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const Pm25VolumeDemo = defineAsyncComponent(() => import('./Pm25VolumeDemo.vue'))

const pm25VolumeCase: DemoCard = {
  id: 'volume-pm25',
  title: '环境可视化-三维 PM2.5 浓度体',
  category: 'data',
  description:
    '把地面监测、气象场与模拟浓度组合成三维污染浓度体：Web Worker 以高斯烟羽模型沿风向解析生成浓度场，经多级瓦片 VoxelProvider 供给单个 VoxelPrimitive 做 GPU 光线步进，支持 PM2.5 / PM10 / NO₂ 多变量切换、空气质量色带与国标分级阈值（35/75/115/150/250）、浓度值域、不透明度、覆盖基底、任意方向剖切与切面导出、时间轴逐小时回放、污染源数量与风向调节，并在地表叠加以浓度着色的监测站点，支持悬浮拾取浓度与站点显隐。',
  tag: '污染体渲染',
  updatedAt: '2026-09-28',
  component: Pm25VolumeDemo
}

export default pm25VolumeCase
