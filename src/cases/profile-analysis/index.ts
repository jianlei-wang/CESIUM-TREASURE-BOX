import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const ProfileAnalysisDemo = defineAsyncComponent(() => import('./ProfileAnalysisDemo.vue'))
import icon from './icon.webp'

const profileAnalysisCase: DemoCard = {
  id: 'profile-analysis',
  title: '空间分析-剖面分析',
  category: 'analysis',
  description: '沿折线路径插值采样真实地形高程，绘制高程剖面图',
  tag: '空间分析',
  icon,
  component: ProfileAnalysisDemo
}

export default profileAnalysisCase
