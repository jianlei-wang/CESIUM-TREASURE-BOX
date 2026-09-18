import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const HeightRestrictionAnalysisDemo = defineAsyncComponent(
  () => import('./HeightRestrictionAnalysisDemo.vue')
)

const heightRestrictionAnalysisCase: DemoCard = {
  id: 'height-restriction-analysis',
  title: '空间分析-控高分析',
  category: 'analysis',
  description:
    '交互绘制限高区域并设定限高值，生成半透明限高体，自动检测区域内超高建筑并高亮，输出超高数量、超高率、最大/平均超高度等统计指标；支持绝对海拔/相对地面限高、区域绘制与清除、体积样式等参数，内置功能实现说明',
  tag: '空间分析',
  icon,
  component: HeightRestrictionAnalysisDemo
}

export default heightRestrictionAnalysisCase
