import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'

const WidgetDistanceLegendDemo = defineAsyncComponent(() => import('./WidgetDistanceLegendDemo.vue'))

export default {
  id: 'widget-distance-legend',
  title: '距离比例尺控件',
  icon,
  category: 'widgets',
  description: '距离比例尺控件：按 1/2/3/5 序列自适应档位，显示当前视角下的地面距离比例尺',
  tag: '地图控件',
  component: WidgetDistanceLegendDemo
}
