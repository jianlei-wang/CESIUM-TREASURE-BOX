import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'

const WidgetLocationBarDemo = defineAsyncComponent(() => import('./WidgetLocationBarDemo.vue'))

export default {
  id: 'widget-location-bar',
  title: '位置信息栏控件',
  icon,
  category: 'widgets',
  description: '位置信息栏控件：底部状态栏实时显示鼠标经纬度、海拔与相机视角、视高',
  tag: '地图控件',
  component: WidgetLocationBarDemo
}
