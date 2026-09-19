import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const FountainThreeDemo = defineAsyncComponent(() => import('./FountainThreeDemo.vue'))

const fountainThreeCase: DemoCard = {
  id: 'fountain-three',
  title: 'Three.Quarks 喷泉粒子',
  category: 'three',
  description:
    '基于 three.quarks 粒子引擎与 Cesium 地球的喷泉特效：锥形发射器喷出高速水滴，重力作用形成抛物线回落，叠加水雾粒子与湍流扰动，所有参数（发射速率、寿命、速度、张角、重力、水雾浓度等）可实时调整并重建粒子系统',
  tag: 'Three.js, three.quarks, 粒子特效',
  component: FountainThreeDemo,
  updatedAt: '2026-09-19'
}

export default fountainThreeCase
