import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const OceanVolumeDemo = defineAsyncComponent(() => import('./OceanVolumeDemo.vue'))

const oceanVolumeCase: DemoCard = {
  id: 'volume-ocean',
  title: '海洋分析-温盐深三维体',
  category: 'data',
  description:
    '东海陆架坡折 / 黄海中部陆架的温盐深三维结构工作台：自建数据管线与体渲染，温度 / 盐度 / 密度 / 流速实时切换，等间距深度重采样保证深度真实，支持月份演变、水平切片、A–B 断面、T–S 散点、等值面、流场箭头、垂向层结（温跃层 / 混合层）与全域统计，并如实标注数据来源与时间性质。',
  tag: '海洋体渲染',
  icon,
  updatedAt: '2026-10-13',
  component: OceanVolumeDemo
}

export default oceanVolumeCase
