import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'

const WidgetMapSplitDemo = defineAsyncComponent(() => import('./WidgetMapSplitDemo.vue'))

export default {
  id: 'widget-map-split',
  title: '地图卷帘控件',
  icon,
  category: 'widgets',
  description: '地图卷帘控件：拖动中央滑块对比左右两侧不同底图，支持街道图 / 影像图切换',
  tag: '地图控件',
  component: WidgetMapSplitDemo
}
