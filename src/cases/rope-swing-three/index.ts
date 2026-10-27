import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const RopeSwingThreeDemo = defineAsyncComponent(() => import('./RopeSwingThreeDemo.vue'))

const ropeSwingCase: DemoCard = {
  id: 'rope-swing-three',
  title: '旋转横臂悬吊球体摆荡',
  category: 'cesium-three',
  description: '横臂绕竖轴旋转，软绳一端连接横臂末端、另一端悬挂刚性球体；球体在离心与重力作用下摆荡并逐步抬升，扫掠砖墙时按碰撞速度撞落构件。',
  tag: 'Cesium + Three.js · 绳索与摆动',
  icon,
  component: RopeSwingThreeDemo,
  updatedAt: '2026-10-26'
}

export default ropeSwingCase
