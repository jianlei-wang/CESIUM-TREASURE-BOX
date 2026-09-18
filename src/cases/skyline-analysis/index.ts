import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const SkylineAnalysisDemo = defineAsyncComponent(() => import('./SkylineAnalysisDemo.vue'))

const skylineAnalysisCase: DemoCard = {
  id: 'skyline-analysis',
  title: '空间分析-天际线分析',
  category: 'analysis',
  description:
    '从观测点沿水平方位角发射射线，求解各方向最高遮挡点并构建三维天际线、射线束与扇形可见天空面；支持观测点高度、方位角范围与采样间隔、自适应细分、最大分析半径、地形叠加、天际线配色等参数，提供极坐标天际线图与量化读数，内置功能实现说明',
  tag: '空间分析',
  icon,
  component: SkylineAnalysisDemo
}

export default skylineAnalysisCase
