import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const OpennessAnalysisDemo = defineAsyncComponent(() => import('./OpennessAnalysisDemo.vue'))

const opennessAnalysisCase: DemoCard = {
  id: 'openness-analysis',
  title: '空间分析-开敞度分析',
  category: 'analysis',
  description:
    '以 Fibonacci 球面采样向周围空间发射射线，逐方向进行建筑/地形遮挡判定，计算正开敞度、负开敞度、天空可视因子与三维全向开敞度；支持采样数、分析半径、分析点高度、半球/全球模式、地形叠加、分析球体与采样点显隐等参数，输出方向分布图与指标读数，内置功能实现说明',
  tag: '空间分析',
  icon,
  component: OpennessAnalysisDemo
}

export default opennessAnalysisCase
