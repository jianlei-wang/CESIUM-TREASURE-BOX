import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'
const PolygonTerrainFlattenDemo = defineAsyncComponent(() => import('./PolygonTerrainFlattenDemo.vue'))

const polygonTerrainFlattenCase: DemoCard = {
  id: 'polygon-terrain-flatten',
  title: '空间分析-多边形地形压平',
  category: 'analysis',
  description: '手动绘制多边形，自动采样区域并直接改写 Cesium 真实地形数据：把多边形内部所有地形瓦片顶点抬升至同一整平高度，生成真正铲平的平面与边缘切面，支持整平高度/抬升参数与填挖方量统计',
  tag: '空间分析',
  icon: iconUrl,
  component: PolygonTerrainFlattenDemo,
  updatedAt: '2026-09-03'
}

export default polygonTerrainFlattenCase
