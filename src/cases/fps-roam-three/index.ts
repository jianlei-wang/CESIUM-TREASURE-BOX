import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const FpsRoamThreeDemo = defineAsyncComponent(() => import('./FpsRoamThreeDemo.vue'))

const fpsRoamCase: DemoCard = {
  id: 'fps-roam-three',
  title: '地理空间第一人称与第三人称漫游',
  category: 'cesium-three',
  description: '角色沿园区路线行走，遇到台阶自动抬升，并可跳跃跨越障碍；支持第一/第三人称切换，第一人称隐藏身体只保留双臂，相机会跟随角色朝向移动。',
  tag: 'Cesium + Three.js · 角色控制',
  component: FpsRoamThreeDemo,
  updatedAt: '2026-10-23'
}

export default fpsRoamCase
