import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'

const WidgetHawkeyeMapDemo = defineAsyncComponent(() => import('./WidgetHawkeyeMapDemo.vue'))

export default {
  id: 'widget-hawkeye-map',
  title: '鹰眼小地图控件',
  icon,
  category: 'widgets',
  description: '鹰眼小地图控件：左下角 2D 圆形鹰眼窗叠加 Bing 街道底图，比主地图低 2 级缩放并框选主图当前视野范围',
  tag: '地图控件',
  component: WidgetHawkeyeMapDemo
}
