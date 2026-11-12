import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const RiskFusionDemo = defineAsyncComponent(() => import('./RiskFusionDemo.vue'))
import icon from './icon.webp'

const riskFusionCase: DemoCard = {
  id: 'geo-risk-fusion',
  title: '空间分析-多灾种风险融合',
  category: 'analysis',
  description:
    '把内涝、大风、地震与高温四类孕灾场按可调权重融合为综合风险面，支持权重滑块、分项开关与风险分级阈值调节，叠加栅格显示分级结果并统计各级面积占比，点击地图返回该点综合风险等级与主导灾种。',
  tag: '多灾种, 风险, 融合, 分级',
  icon,
  component: RiskFusionDemo,
  updatedAt: '2026-11-12'
}

export default riskFusionCase
