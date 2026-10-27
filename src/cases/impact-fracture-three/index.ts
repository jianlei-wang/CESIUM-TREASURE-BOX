import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const ImpactFractureThreeDemo = defineAsyncComponent(() => import('./ImpactFractureThreeDemo.vue'))

const impactFractureCase: DemoCard = {
  id: 'impact-fracture-three',
  title: '高速撞击下的结构断裂',
  category: 'cesium-three',
  description: '抛射体以设定速度撞击塔体、桥面、石块或山形体，撞击点附近的预破碎构件获得冲量与旋转，脱离主体后按重力抛撒、落地并逐渐静止；可切换结构、速度、质量与断裂半径。',
  tag: 'Cesium + Three.js · 冲击断裂',
  icon,
  component: ImpactFractureThreeDemo,
  updatedAt: '2026-10-26'
}

export default impactFractureCase
