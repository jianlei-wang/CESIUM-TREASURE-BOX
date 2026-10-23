import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const UrbanFloodThreeDemo = defineAsyncComponent(() => import('./UrbanFloodThreeDemo.vue'))

const urbanFloodCase: DemoCard = {
  id: 'urban-flood-three',
  title: '城市洪涝淹没与动态水流',
  category: 'cesium-three',
  description: '按入流过程线抬升城区水位，建筑首层逐步被淹没，水面叠加波纹与流动矢量；可调入流峰值、最大水深、涨落时长、地表糙率与建筑密度，并输出风险等级。',
  tag: 'Cesium + Three.js · 浅水演示',
  component: UrbanFloodThreeDemo,
  updatedAt: '2026-10-23'
}

export default urbanFloodCase
