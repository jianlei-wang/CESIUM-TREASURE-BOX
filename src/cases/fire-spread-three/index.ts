import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const FireSpreadThreeDemo = defineAsyncComponent(() => import('./FireSpreadThreeDemo.vue'))

const fireSpreadCase: DemoCard = {
  id: 'fire-spread-three',
  title: '建筑与林地火灾蔓延及烟羽',
  category: 'cesium-three',
  icon,
  description: '在燃料栅格中心点火，火焰按燃料负载、湿度、风速和扑救状态向相邻网格传播，同时生成上升火苗与顺风烟羽；可观察已烧面积、火线扩展速度和烟羽高度。',
  tag: 'Cesium + Three.js · 火灾传播',
  component: FireSpreadThreeDemo,
  updatedAt: '2026-10-23'
}

export default fireSpreadCase
