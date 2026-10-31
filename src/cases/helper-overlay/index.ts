import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const HelperOverlayDemo = defineAsyncComponent(() => import('./HelperOverlayDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-overlay',
  title: '遮挡线叠加层',
  category: 'scene',
  description: 'HTML/SVG 叠加层与遮罩线：被场景遮挡的线段自动隐藏',
  tag: '场景示例',
  component: HelperOverlayDemo,
  updatedAt: '2026-10-30'
}

export default caseItem
