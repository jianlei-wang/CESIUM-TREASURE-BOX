import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const PrecipitationThreeDemo = defineAsyncComponent(() => import('./PrecipitationThreeDemo.vue'))

const precipitationCase: DemoCard = {
  id: 'precipitation-three',
  title: '雨雪冰雹与地表积水',
  category: 'cesium-three',
  description: '在地理场景中模拟降雨、降雪和冰雹：粒子按类型改变下落速度、颜色和漂移，累计降水驱动地表积水范围与深度；可调降水强度、风速、重力、气温和积水增长系数。',
  tag: 'Cesium + Three.js · 降水粒子',
  component: PrecipitationThreeDemo,
  updatedAt: '2026-10-23'
}

export default precipitationCase
