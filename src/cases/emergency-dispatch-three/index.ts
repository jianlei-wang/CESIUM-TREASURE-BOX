import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const EmergencyDispatchThreeDemo = defineAsyncComponent(() => import('./EmergencyDispatchThreeDemo.vue'))

const emergencyDispatchCase: DemoCard = {
  id: 'emergency-dispatch-three',
  title: '城市应急联动与救援调度',
  category: 'cesium-three',
  description: '火灾事故触发应急调度，多支地面救援队从不同站点沿道路驶向事故点，无人机从空中基地同步起飞侦察；协同开启后整体响应速度提升，实时显示首批到场时间、无人机 ETA 与现场覆盖半径。',
  tag: 'Cesium + Three.js · 应急联动',
  component: EmergencyDispatchThreeDemo,
  updatedAt: '2026-10-23'
}

export default emergencyDispatchCase
