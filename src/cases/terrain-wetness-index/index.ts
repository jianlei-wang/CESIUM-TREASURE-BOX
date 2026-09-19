import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const DemoTwi = defineAsyncComponent(() => import('./DemoTwi.vue'))

const terrainWetnessIndexCase: DemoCard = {
  id: 'terrain-wetness-index',
  title: '地形湿润指数（TWI）分析',
  category: 'analysis',
  description:
    '基于 Cesium 真实地形采样或导入 DEM，在自绘多边形分析区内计算地形湿润指数 TWI = ln(a / tanβ)：经洼地填充、D8 流向与汇流累积得到单宽汇水面积，结合坡度正切逐像元求解并分位数分级设色，同时用 Marching Squares 提取湿润区等值线；支持真实地形采集/导入 DEM、区域绘制、参数提示、图例与结果说明、技术路线、在线报告与 PDF 导出，以及 GeoTIFF 栅格与 SHP/GeoJSON 矢量输出。',
  tag: 'Cesium, 地形分析, TWI, 汇流累积, 水分再分配',
  icon,
  component: DemoTwi,
  updatedAt: '2026-09-19'
}

export default terrainWetnessIndexCase
