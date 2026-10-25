import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const UavAvoidanceThreeDemo = defineAsyncComponent(() => import('./UavAvoidanceThreeDemo.vue'))

const uavAvoidanceCase: DemoCard = {
  id: 'uav-avoidance-three',
  title: '无人机航线飞行与建筑避障',
  category: 'cesium-three',
  icon,
  description: '无人机沿环形航点自动巡航，依据建筑包围盒与传感器范围抬升高度并侧向绕行；可调巡航高度、速度、感知距离、建筑密度与风漂移，实时显示最近障碍距离和剩余电量。',
  tag: 'Cesium + Three.js · 飞行与避障',
  component: UavAvoidanceThreeDemo,
  updatedAt: '2026-10-23'
}

export default uavAvoidanceCase
