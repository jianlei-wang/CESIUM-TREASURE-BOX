import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const FreeFallThreeDemo = defineAsyncComponent(() => import('./FreeFallThreeDemo.vue'))

const freeFallCase: DemoCard = {
  id: 'free-fall-three',
  title: '地理空间自由落体与地形反弹',
  category: 'cesium-three',
  icon,
  description: '在选定地理锚点的 ENU 局部坐标中投放球体、木箱或桶体，按重力加速、地面碰撞恢复系数反弹并绘制三维轨迹；可切换几何体、数量、释放高度与材质弹性。',
  tag: 'Cesium + Three.js · 刚体动力学',
  component: FreeFallThreeDemo,
  updatedAt: '2026-10-23'
}

export default freeFallCase
