import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'

const WidgetContextMenuDemo = defineAsyncComponent(() => import('./WidgetContextMenuDemo.vue'))

export default {
  id: 'widget-context-menu',
  title: '右键菜单控件',
  icon,
  category: 'widgets',
  description: '右键菜单控件：在地图上右键弹出上下文菜单，支持飞行、添加标记与坐标信息展示',
  tag: '地图控件',
  component: WidgetContextMenuDemo
}
