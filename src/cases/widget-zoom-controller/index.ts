import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'

const WidgetZoomControllerDemo = defineAsyncComponent(() => import('./WidgetZoomControllerDemo.vue'))

export default {
  id: 'widget-zoom-controller',
  title: '缩放控制器控件',
  icon,
  category: 'widgets',
  description: '缩放控制器控件：朝视线焦点前进放大、反方向拉远缩小，一键飞回默认视角',
  tag: '地图控件',
  component: WidgetZoomControllerDemo
}
