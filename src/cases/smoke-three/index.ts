import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const SmokeThreeDemo = defineAsyncComponent(() => import('./SmokeThreeDemo.vue'))

const smokeThreeCase: DemoCard = {
  id: 'smoke-three',
  title: 'Three.Quarks 烟雾粒子',
  category: 'three',
  description:
    '基于 three.quarks 粒子引擎与 Cesium 地球的烟雾特效：程序化烟雾纹理配合上升力、风力与三维湍流场，粒子随生命周期逐渐放大、自旋、变淡并漂移扩散，所有参数（发射速率、寿命、上升力、风力、湍流、自旋、不透明度等）可实时调整并重建粒子系统',
  tag: 'Three.js, three.quarks, 粒子特效',
  component: SmokeThreeDemo,
  updatedAt: '2026-09-19'
}

export default smokeThreeCase
