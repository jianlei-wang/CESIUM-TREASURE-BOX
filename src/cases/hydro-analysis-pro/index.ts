import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const HydroAnalysisProDemo = defineAsyncComponent(() => import('./HydroAnalysisProDemo.vue'))

const hydroAnalysisProCase: DemoCard = {
  id: 'hydro-analysis-pro',
  title: '空间分析-水文分析(升级版)',
  category: 'analysis',
  description: '在基础版水文分析之上迭代：地形采集支持按行列数或按间距(米)设置网格密度；逐步分析成果集中在页面左上方，栅格成果导出 GeoTIFF、矢量成果导出 GeoJSON 或 SHP(含属性)；每个步骤提供原理与实现说明的帮助图标',
  tag: '空间分析',
  icon,
  component: HydroAnalysisProDemo,
  updatedAt: '2026-09-04'
}

export default hydroAnalysisProCase
