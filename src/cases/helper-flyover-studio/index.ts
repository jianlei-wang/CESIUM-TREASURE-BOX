import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const HelperFlyoverStudioDemo = defineAsyncComponent(() => import('./HelperFlyoverStudioDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-flyover-studio',
  title: '飞行视频工作台',
  category: 'scene',
  description: '拖入 GPX 轨迹，选择画幅与清晰度，逐帧渲染并导出 MP4 飞行视频',
  tag: '场景示例',
  component: HelperFlyoverStudioDemo,
  updatedAt: '2026-10-30'
}

export default caseItem
