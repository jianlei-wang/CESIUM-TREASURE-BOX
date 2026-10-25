import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const RobotPatrolThreeDemo = defineAsyncComponent(() => import('./RobotPatrolThreeDemo.vue'))

const robotPatrolCase: DemoCard = {
  id: 'robot-patrol-three',
  title: '机器人巡检导航与目标感知',
  category: 'cesium-three',
  icon,
  description: '巡检机器人沿园区航点路线循环运动，遇障碍时按横向偏移绕行，前向感知锥随扫描距离缩放并识别最近建筑目标；可调速度、感知范围、航点数量与机器人类型。',
  tag: 'Cesium + Three.js · 机器人导航',
  component: RobotPatrolThreeDemo,
  updatedAt: '2026-10-23'
}

export default robotPatrolCase
