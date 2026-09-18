import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const WaterDepthExtractionDemo = defineAsyncComponent(() => import('./WaterDepthExtractionDemo.vue'))

const waterDepthExtractionCase: DemoCard = {
  id: 'water-depth-extraction',
  title: '水深图提取',
  category: 'water',
  description:
    '通过真实地形采样（水面高程控制）或上传 DEM/水深栅格、归一化水深图生成水深网格，支持贴地框选矩形范围实时预览，水深图叠加地图并导出 GeoTIFF/PNG',
  tag: '水深提取',
  icon,
  component: WaterDepthExtractionDemo
}

export default waterDepthExtractionCase
