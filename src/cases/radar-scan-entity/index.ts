import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const RadarScanEntityDemo = defineAsyncComponent(() => import('./RadarScanEntityDemo.vue'))
const radarScanEntityCase: DemoCard = {
  id: 'radar-scan-entity',
  title: '三维特效-雷达扫描(Entity)',
  category: 'effects',
  description: 'Entity 实现的半球雷达扫描效果，支持扫描范围、旋转速度、竖立张角、颜色与半球/扫描面显隐等参数实时调节，可点击地图定位',
  tag: '雷达扫描',
  icon,
  component: RadarScanEntityDemo,
  updatedAt: '2026-08-27'
}

export default radarScanEntityCase
