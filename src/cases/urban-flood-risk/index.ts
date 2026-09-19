import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const DemoFloodRisk = defineAsyncComponent(() => import('./DemoFloodRisk.vue'))

const urbanFloodRiskCase: DemoCard = {
  id: 'urban-flood-risk',
  title: '城市内涝风险评估（简版）',
  category: 'analysis',
  description:
    '基于 Cesium 真实地形采样或导入 DEM，在自绘多边形分析区内开展城市内涝风险评估：对 DEM 填洼后计算 D8 汇流累积，结合地形位置指数（TPI）与坡度构建孕灾因子，叠加可调降雨强度加权得到 0~100 风险指数，分位数分级设色并提取高风险区等值线；支持真实地形采集/导入 DEM、区域绘制、参数提示、图例与结果说明、技术路线、在线报告与 PDF 导出，以及 GeoTIFF 栅格与 SHP/GeoJSON 矢量输出。',
  tag: 'Cesium, 地形分析, 城市内涝, 汇流累积, TPI',
  icon,
  component: DemoFloodRisk,
  updatedAt: '2026-09-19'
}

export default urbanFloodRiskCase
