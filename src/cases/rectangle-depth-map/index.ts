import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const RectangleDepthMapDemo = defineAsyncComponent(() => import('./RectangleDepthMapDemo.vue'))
import icon from './icon.webp'

const rectangleDepthMapCase: DemoCard = {
  id: 'rectangle-depth-map',
  title: '空间分析-深度图提取',
  category: 'analysis',
  description: '支持输入四至经纬度或在地图上框选矩形区域，按分辨率或间距(米)采样地形高度，输出带 WGS84 地理坐标的 PNG 与 GeoTIFF 深度图',
  tag: '空间分析',
  component: RectangleDepthMapDemo,
  icon,
  updatedAt: '2026-08-25'
}

export default rectangleDepthMapCase
