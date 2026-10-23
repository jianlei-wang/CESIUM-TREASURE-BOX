import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const AirDispersionThreeDemo = defineAsyncComponent(() => import('./AirDispersionThreeDemo.vue'))

const airDispersionCase: DemoCard = {
  id: 'air-dispersion-three',
  title: '工业园区大气污染扩散',
  category: 'cesium-three',
  icon,
  description: '多座烟囱连续排放污染物粒子，风场负责水平输运，大气稳定度决定垂直混合和扩散强度；粒子颜色随龄期从高温橙色过渡到冷色，可直观看稳定层结下的长烟羽与不稳定层结下的快速抬升。',
  tag: 'Cesium + Three.js · 环境扩散',
  component: AirDispersionThreeDemo,
  updatedAt: '2026-10-23'
}

export default airDispersionCase
