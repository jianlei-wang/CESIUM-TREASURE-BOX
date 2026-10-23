import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CollapseFractureThreeDemo = defineAsyncComponent(() => import('./CollapseFractureThreeDemo.vue'))

const collapseFractureCase: DemoCard = {
  id: 'collapse-fracture-three',
  title: '建筑预破碎与局部坍塌',
  category: 'cesium-three',
  icon,
  description: '以参数化楼体块阵表示预破碎构件，触发后按距离衰减的冲量把楼层块体转为动态刚体，展示倾覆、抛射、落地与堆存；可调层数、柱网、冲量、延迟、阻尼和重建模式。',
  tag: 'Cesium + Three.js · 多刚体断裂',
  component: CollapseFractureThreeDemo,
  updatedAt: '2026-10-23'
}

export default collapseFractureCase
