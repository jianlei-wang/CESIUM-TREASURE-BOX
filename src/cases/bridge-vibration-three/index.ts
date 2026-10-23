import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const BridgeVibrationThreeDemo = defineAsyncComponent(() => import('./BridgeVibrationThreeDemo.vue'))

const bridgeVibrationCase: DemoCard = {
  id: 'bridge-vibration-three',
  title: '桥梁车辆荷载与结构振动',
  category: 'cesium-three',
  icon,
  description: '多辆车辆按设定速度通过桥面，按影响线与一阶模态近似计算各跨段挠度，桥面随荷载起伏并绘制动态变形曲线；可调车重、车速、桥面刚度、阻尼与视觉放大倍数。',
  tag: 'Cesium + Three.js · 移动荷载',
  component: BridgeVibrationThreeDemo,
  updatedAt: '2026-10-23'
}

export default bridgeVibrationCase
