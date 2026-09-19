import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const FlameThreeDemo = defineAsyncComponent(() => import('./FlameThreeDemo.vue'))

const flameThreeCase: DemoCard = {
  id: 'flame-three',
  title: 'Three.Quarks 火焰粒子',
  category: 'three',
  description:
    '基于 three.quarks 粒子引擎与 Cesium 地球的火焰特效：锥形发射器配合浮力力场与湍流场，明火主体由亮黄到暗红渐变收缩，叠加高速飞溅火星，所有参数（发射速率、寿命、浮力、张角、湍流强度等）可实时调整并重建粒子系统',
  tag: 'Three.js, three.quarks, 粒子特效',
  component: FlameThreeDemo,
  updatedAt: '2026-09-19'
}

export default flameThreeCase
