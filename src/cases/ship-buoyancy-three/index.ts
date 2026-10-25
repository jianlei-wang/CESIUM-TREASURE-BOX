import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const ShipBuoyancyThreeDemo = defineAsyncComponent(() => import('./ShipBuoyancyThreeDemo.vue'))

const shipBuoyancyCase: DemoCard = {
  id: 'ship-buoyancy-three',
  title: '波浪、船舶与浮力响应',
  category: 'cesium-three',
  icon,
  description: '海面由多频正弦波叠加生成动态波面，船体按采样波高与斜率产生升沉、横摇和纵摇，浮标随波起伏；可调波高、周期、浪向、风速、吃水和浮标数量。',
  tag: 'Cesium + Three.js · 波浪与浮力',
  component: ShipBuoyancyThreeDemo,
  updatedAt: '2026-10-23'
}

export default shipBuoyancyCase
