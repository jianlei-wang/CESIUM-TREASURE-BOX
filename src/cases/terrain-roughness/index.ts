import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const DemoRoughness = defineAsyncComponent(() => import('./DemoRoughness.vue'))

const terrainRoughnessCase: DemoCard = {
  id: 'terrain-roughness',
  title: '地形粗糙度分析',
  category: 'analysis',
  description:
    '基于 Cesium 真实地形采样或导入 DEM，在自绘多边形分析区内计算地形粗糙度：可选焦点均值平滑后，用邻域极差法（窗口内 max−min）或表面积比值法（三角网三维表面积与投影面积之比）逐像元度量地表起伏与破碎程度，分位数分级设色并提取粗糙区等值线；支持真实地形采集/导入 DEM、区域绘制、参数提示、图例与结果说明、技术路线、在线报告与 PDF 导出，以及 GeoTIFF 栅格与 SHP/GeoJSON 矢量输出。',
  tag: 'Cesium, 地形分析, 粗糙度, 邻域极差, 表面积比值',
  icon,
  component: DemoRoughness,
  updatedAt: '2026-09-19'
}

export default terrainRoughnessCase
