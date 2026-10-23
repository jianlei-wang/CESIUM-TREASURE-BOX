import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const ExcavatorCycleThreeDemo = defineAsyncComponent(() => import('./ExcavatorCycleThreeDemo.vue'))

const excavatorCycleCase: DemoCard = {
  id: 'excavator-cycle-three',
  title: '挖掘机作业循环与物料装卸',
  category: 'cesium-three',
  description: '挖掘机按作业循环完成回转、下探、挖掘、提升和卸料，动臂、斗杆与铲斗按预设角度联动，铲斗载荷随土体密度变化，卸料时生成颗粒状土屑；面板实时给出产量与回转角度。',
  tag: 'Cesium + Three.js · 关节机械',
  component: ExcavatorCycleThreeDemo,
  updatedAt: '2026-10-23'
}

export default excavatorCycleCase
