import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const FlameThreeDemo = defineAsyncComponent(() => import('./FlameThreeDemo.vue'))

const flameThreeCase: DemoCard = {
  id: 'flame-three',
  title: 'Three.Quarks 火焰粒子',
  category: 'particles',
  description:
    '基于 three.quarks 粒子引擎与 Cesium 地球的火焰特效：锥形发射器配合浮力力场与湍流场，火焰核心自地面向上浮升，随生命周期由亮黄渐变为橙红并收束消散，叠加高速飞溅火星。发射速率、寿命、浮力、张角、湍流强度等参数均可实时调整并即时生效',
  tag: 'Three.js, three.quarks, 粒子特效',
  component: FlameThreeDemo,
  updatedAt: '2026-09-19'
}

export default flameThreeCase
