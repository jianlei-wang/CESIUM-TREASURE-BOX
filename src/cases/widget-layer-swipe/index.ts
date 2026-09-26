import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'
import type { DemoCard } from '../types'

const WidgetLayerSwipeDemo = defineAsyncComponent(() => import('./WidgetLayerSwipeDemo.vue'))

const caseItem: DemoCard = {
  id: 'widget-layer-swipe',
  title: '图层滑动对比控件',
  category: 'widgets',
  description: '图层滑动对比控件：拖动中央分割条分别查看两侧不同底图，支持水平 / 垂直两种方向与分割比例实时预览',
  tag: '地图控件',
  icon,
  component: WidgetLayerSwipeDemo,
  updatedAt: '2026-09-26'
}

export default caseItem
