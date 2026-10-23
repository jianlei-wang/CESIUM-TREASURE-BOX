import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const VehicleFollowThreeDemo = defineAsyncComponent(() => import('./VehicleFollowThreeDemo.vue'))

const vehicleFollowCase: DemoCard = {
  id: 'vehicle-follow-three',
  title: '城市车辆驾驶与道路跟随',
  category: 'cesium-three',
  description: '车辆沿参数化道路中心线行驶，按目标速度、坡度与摩擦逐步收敛；对向与同向车辆按车道偏移运动，实时显示航向、里程和跟车数量，可切换自动巡航与手动摆动。',
  tag: 'Cesium + Three.js · 车辆运动',
  component: VehicleFollowThreeDemo,
  updatedAt: '2026-10-23'
}

export default vehicleFollowCase
