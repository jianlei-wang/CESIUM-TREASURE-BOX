import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const CimDroneRoamDemo = defineAsyncComponent(() => import('./CimDroneRoamDemo.vue'))

const cimDroneRoamCase: DemoCard = {
  id: 'cim-drone-roam',
  title: '无人机航线漫游',
  category: 'scene',
  description: '沿闭合航线驱动无人机模型巡航，支持跟随视角、速度与进度控制',
  tag: '场景漫游',
  component: CimDroneRoamDemo,
  updatedAt: '2026-10-25'
}

export default cimDroneRoamCase
