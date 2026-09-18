import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'

const WidgetPopupDemo = defineAsyncComponent(() => import('./WidgetPopupDemo.vue'))

export default {
  id: 'widget-popup',
  title: '气泡弹窗控件',
  icon,
  category: 'widgets',
  description: '气泡弹窗控件：点击地图在拾取点上方弹出贴地坐标信息气泡，随相机移动贴附',
  tag: '地图控件',
  component: WidgetPopupDemo
}
