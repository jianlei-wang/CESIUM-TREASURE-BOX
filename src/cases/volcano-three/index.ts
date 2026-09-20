import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const VolcanoThreeDemo = defineAsyncComponent(() => import('./VolcanoThreeDemo.vue'))

const volcanoThreeCase: DemoCard = {
  id: 'volcano-three',
  title: 'Three.Quarks 火山喷发',
  category: 'particles',
  description:
    '参考“火山喷发全流程”方案：同一喷口分层叠加三类发射器——高速亮色熔岩喷泉、受风切变弯曲的灰烬柱、按抛物线飞溅落地的暗色岩块。熔岩量/速度/尺寸、灰烬量/寿命/体积、风切变、岩块量与重力均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 地质',
  component: VolcanoThreeDemo,
  updatedAt: '2026-09-20'
}

export default volcanoThreeCase
