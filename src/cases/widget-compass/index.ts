import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'

const WidgetCompassDemo = defineAsyncComponent(() => import('./WidgetCompassDemo.vue'))

export default {
  id: 'widget-compass',
  title: '罗盘控件',
  icon,
  category: 'widgets',
  description: '罗盘控件：外圈随相机航向旋转指示方向，支持拖拽旋转视角与漫游，双击回正俯视视角',
  tag: '地图控件',
  component: WidgetCompassDemo
}
