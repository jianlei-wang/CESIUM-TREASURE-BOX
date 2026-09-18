import { defineAsyncComponent } from 'vue'
import icon from './icon.jpg'

const DrillStrataDemo = defineAsyncComponent(() => import('./DrillStrataDemo.vue'))

export default {
  id: 'drill-strata',
  title: '三维地层-钻孔建模',
  icon,
  category: 'data',
  description: '依据 19 处钻孔分层数据以 IDW 插值生成起伏嵌套的三维地层体素，支持整体/分层显隐控制与地层展开合并展示',
  tag: '三维地层',
  component: DrillStrataDemo
}
