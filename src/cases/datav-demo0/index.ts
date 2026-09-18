import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const Datav0Demo = defineAsyncComponent(() => import('../../datav/demo0/Datav0Screen.vue'))

const caseItem: DemoCard = {
  id: 'datav-demo0',
  title: '三维地图大屏·经济运行监测',
  category: 'datav',
  description: '四川三维立体地图大屏：轮廓扫光 / 边缘流光 / 网格星空场景，含进出口与三产四组图表，支持切换地图样式与纯净模式',
  tag: '可视化大屏',
  icon,
  component: Datav0Demo,
  updatedAt: '2026-09-08',
}

export default caseItem
