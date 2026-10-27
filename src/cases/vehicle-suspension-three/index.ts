import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const VehicleSuspensionThreeDemo = defineAsyncComponent(() => import('./VehicleSuspensionThreeDemo.vue'))

const vehicleSuspensionCase: DemoCard = {
  id: 'vehicle-suspension-three',
  title: '轮式车辆悬架与撞击墙体',
  category: 'cesium-three',
  description: '车辆在坡道与直道上加速行驶，四轮悬架按质量、刚度与阻尼产生压缩、俯仰和侧倾；驶入砖墙时按车速与质量转化冲量，墙体构件被撞散、抛落并逐渐静止。',
  tag: 'Cesium + Three.js · 车辆动力学',
  icon,
  component: VehicleSuspensionThreeDemo,
  updatedAt: '2026-10-26'
}

export default vehicleSuspensionCase
