import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'

const WidgetLoadingMaskDemo = defineAsyncComponent(() => import('./WidgetLoadingMaskDemo.vue'))

export default {
  id: 'widget-loading-mask',
  title: '初始化加载控件',
  icon,
  category: 'widgets',
  description: '初始化加载控件：全屏半透明遮罩配五个错峰闪烁光点，用于初始化与数据加载期间的过渡反馈',
  tag: '地图控件',
  component: WidgetLoadingMaskDemo
}
