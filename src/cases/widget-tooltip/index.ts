import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'

const WidgetTooltipDemo = defineAsyncComponent(() => import('./WidgetTooltipDemo.vue'))

export default {
  id: 'widget-tooltip',
  title: '提示浮层控件',
  icon,
  category: 'widgets',
  description: '提示浮层控件：鼠标移动时浮层跟随光标右侧显示拾取坐标或自定义文本',
  tag: '地图控件',
  component: WidgetTooltipDemo
}
