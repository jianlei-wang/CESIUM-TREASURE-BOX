import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const HelperOverlayDemo = defineAsyncComponent(() => import('./HelperOverlayDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-overlay',
  title: '遮挡线叠加层',
  category: 'scene',
  description: 'HTML/SVG 叠加层与遮罩线：被场景遮挡的线段自动隐藏',
  tag: '场景示例',
  icon,
  component: HelperOverlayDemo,
  updatedAt: '2026-11-10'
}

export default caseItem
