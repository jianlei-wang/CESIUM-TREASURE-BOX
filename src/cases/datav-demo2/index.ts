import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const Datav2Demo = defineAsyncComponent(() => import('../../datav/demo2/Datav2Screen.vue'))

const caseItem: DemoCard = {
  id: 'datav-demo2',
  title: '三维地图大屏·电力运行监测',
  category: 'datav',
  description: '黑底雾化三维四川地图：侧壁扫光 / 飞线 / 锥标 / 边界光墙 / 镜面反射 / 上升光束，含发电用电六组图表',
  tag: '可视化大屏',
  icon,
  component: Datav2Demo,
  updatedAt: '2026-09-08',
}

export default caseItem
