import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const WidgetSceneShotDemo = defineAsyncComponent(() => import('./WidgetSceneShotDemo.vue'))

const caseItem: DemoCard = {
  id: 'widget-scene-shot',
  title: '场景截图控件',
  category: 'widgets',
  description: '场景截图控件：以可调渲染分辨率倍率对当前场景一键截图，导出 PNG / JPG 图片',
  tag: '截图导出',
  icon,
  component: WidgetSceneShotDemo,
  updatedAt: '2026-09-07'
}

export default caseItem
