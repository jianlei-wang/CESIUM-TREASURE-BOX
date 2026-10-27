import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const RotatingClothThreeDemo = defineAsyncComponent(() => import('./RotatingClothThreeDemo.vue'))

const rotatingClothCase: DemoCard = {
  id: 'rotating-cloth-three',
  title: '旋转横臂驱动旗帜布料',
  category: 'cesium-three',
  description: '竖直立柱上的横臂绕轴旋转，布料上缘固定在横臂外段，受重力、离心与空气阻力作用向外张开并产生行波；横扫经过砖墙时按布料接触速度撞落构件。',
  tag: 'Cesium + Three.js · 旋转布料',
  icon,
  component: RotatingClothThreeDemo,
  updatedAt: '2026-10-26'
}

export default rotatingClothCase
