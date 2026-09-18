import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const terrainHeightCompareCase: DemoCard = {
  id: 'terrain-height-compare',
  title: '空间分析-地形高度场·五方案对比',
  category: 'analysis',
  description: '同区域同分辨率依次运行五种高度场提取方案，比较耗时、精度与逐像素差异',
  tag: '空间分析',
  icon,
  component: Demo
}

export default terrainHeightCompareCase
