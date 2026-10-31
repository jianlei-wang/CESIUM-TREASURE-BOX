import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const HelperPathFlyoverDemo = defineAsyncComponent(() => import('./HelperPathFlyoverDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-path-flyover',
  title: '轨迹飞行',
  category: 'scene',
  description: '沿 GPX/GeoJSON 轨迹的相机动画，支持预设机位、地名标注与视频导出',
  tag: '场景示例',
  component: HelperPathFlyoverDemo,
  updatedAt: '2026-10-30'
}

export default caseItem
