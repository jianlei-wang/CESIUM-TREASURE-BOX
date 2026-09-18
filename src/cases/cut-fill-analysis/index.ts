import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const CutFillAnalysisDemo = defineAsyncComponent(() => import('./CutFillAnalysisDemo.vue'))
import icon from './icon.webp'

const cutFillAnalysisCase: DemoCard = {
  id: 'cut-fill-analysis',
  title: '空间分析-填挖方分析',
  category: 'analysis',
  description: '绘制多边形区域，按精度采样生成三角网格，计算填方/挖方的面积与体积',
  tag: '空间分析',
  icon,
  component: CutFillAnalysisDemo
}

export default cutFillAnalysisCase
