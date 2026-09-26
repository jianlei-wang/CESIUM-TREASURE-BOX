import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'
import type { DemoCard } from '../types'

const WidgetTourRecorderDemo = defineAsyncComponent(() => import('./WidgetTourRecorderDemo.vue'))

const caseItem: DemoCard = {
  id: 'widget-tour-recorder',
  title: '地图导览录制控件',
  category: 'widgets',
  description: '地图导览录制控件：采集多个相机关键帧，逐段设置停留与过渡时长并飞行动画，一键录制为导览视频，支持配置保存与加载',
  tag: '录制导出',
  icon,
  component: WidgetTourRecorderDemo,
  updatedAt: '2026-09-26'
}

export default caseItem
