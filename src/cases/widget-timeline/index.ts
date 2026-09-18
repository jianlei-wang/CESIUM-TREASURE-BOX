import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const WidgetTimelineDemo = defineAsyncComponent(() => import('./WidgetTimelineDemo.vue'))
import iconUrl from './icon.webp'

const widgetTimelineCase: DemoCard = {
  id: 'widget-timeline',
  title: '自定义时间轴控件',
  category: 'widgets',
  description: '复刻 Cesium 时间轴与动画控件能力：播放/反向/倍率、点击跳转、刮擦、窗口缩放平移、循环钳制，并提供光照与阴影开关及三种视觉样式',
  tag: '地图控件',
  icon: iconUrl,
  component: WidgetTimelineDemo,
  updatedAt: '2026-09-10'
}

export default widgetTimelineCase
