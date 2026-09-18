import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const HydroAnalysisDemo = defineAsyncComponent(() => import('./HydroAnalysisDemo.vue'))

const hydroAnalysisCase: DemoCard = {
  id: 'hydro-analysis',
  title: '空间分析-水文分析(基础版)',
  category: 'analysis',
  description: '基于真实地形 DEM 分步完成洼地填平、D8 流向、汇流累积、栅格河网提取、河网矢量化，并可拾取倾泻点生成汇水流域，支持分辨率/阈值/显示样式等参数调整',
  tag: '空间分析',
  icon,
  component: HydroAnalysisDemo,
  updatedAt: '2026-09-04'
}

export default hydroAnalysisCase
