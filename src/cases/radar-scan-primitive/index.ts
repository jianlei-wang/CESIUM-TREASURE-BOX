import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const RadarScanPrimitiveDemo = defineAsyncComponent(() => import('./RadarScanPrimitiveDemo.vue'))
const radarScanPrimitiveCase: DemoCard = {
  id: 'radar-scan-primitive',
  title: '三维特效-雷达扫描(Primitive)',
  category: 'effects',
  description: 'Primitive 实现的半球雷达扫描效果，与 Entity 版效果一致，支持扫描范围、旋转速度、竖立张角、颜色与半球/扫描面显隐等参数实时调节',
  tag: '雷达扫描',
  icon,
  component: RadarScanPrimitiveDemo,
  updatedAt: '2026-08-27'
}

export default radarScanPrimitiveCase
