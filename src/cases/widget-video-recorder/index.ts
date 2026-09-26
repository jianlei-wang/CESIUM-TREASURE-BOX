import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'
import type { DemoCard } from '../types'

const WidgetVideoRecorderDemo = defineAsyncComponent(() => import('./WidgetVideoRecorderDemo.vue'))

const caseItem: DemoCard = {
  id: 'widget-video-recorder',
  title: '视频录制控件',
  category: 'widgets',
  description: '视频录制控件：录制当前三维场景（整图或框选区域）为视频，支持题图/来源水印与位置设置，导出 MP4 / WebM',
  tag: '录制导出',
  icon,
  component: WidgetVideoRecorderDemo,
  updatedAt: '2026-09-26'
}

export default caseItem
