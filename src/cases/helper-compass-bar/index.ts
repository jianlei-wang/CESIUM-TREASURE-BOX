import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const HelperCompassBarDemo = defineAsyncComponent(() => import('./HelperCompassBarDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-compass-bar',
  title: '罗盘刻度条',
  category: 'widgets',
  description: '水平罗盘刻度条，随相机朝向滚动，可拖动或点击刻度转向',
  tag: '界面控件',
  component: HelperCompassBarDemo,
  updatedAt: '2026-10-30'
}

export default caseItem
