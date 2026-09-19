import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const DemoSuitability = defineAsyncComponent(() => import('./DemoSuitability.vue'))

const landUseSuitabilityCase: DemoCard = {
  id: 'land-use-suitability',
  title: '土地利用适宜性评价',
  category: 'analysis',
  description:
    '基于 Cesium 真实地形采样或导入 DEM，在自绘多边形分析区内开展土地利用适宜性评价：选取坡度、高程、坡向与地形湿润指数四类因子，分别归一化为 0~1 适宜性得分，按可调权重加权叠加为 0~100 综合得分，并对超限坡度施加约束惩罚，分位数分级设色并提取适宜区等值线；支持真实地形采集/导入 DEM、区域绘制、参数提示、图例与结果说明、技术路线、在线报告与 PDF 导出，以及 GeoTIFF 栅格与 SHP/GeoJSON 矢量输出。',
  tag: 'Cesium, 地形分析, 适宜性评价, 多因子加权, 坡度高程',
  icon,
  component: DemoSuitability,
  updatedAt: '2026-09-19'
}

export default landUseSuitabilityCase
