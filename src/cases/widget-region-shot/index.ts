import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const WidgetRegionShotDemo = defineAsyncComponent(() => import('./WidgetRegionShotDemo.vue'))

const caseItem: DemoCard = {
  id: 'widget-region-shot',
  title: '区域截图控件',
  category: 'widgets',
  description: '区域截图控件：在当前页面上遮罩拖拽框选任意矩形区域，松开立即按所选区域导出 PNG / JPG 图鉴图片',
  tag: '截图导出',
  icon,
  component: WidgetRegionShotDemo,
  updatedAt: '2026-09-07'
}

export default caseItem
