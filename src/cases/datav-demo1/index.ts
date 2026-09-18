import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const Datav1Demo = defineAsyncComponent(() => import('../../datav/demo1/Datav1Screen.vue'))

const caseItem: DemoCard = {
  id: 'datav-demo1',
  title: '三维地图大屏·智慧城市数据大脑',
  category: 'datav',
  description: '暖色三维四川地图大屏：挤出柱状 / 热力 / 云雾 / 旋转底盘，含人口与税收六组图表，支持图层开关与纯净模式',
  tag: '可视化大屏',
  icon,
  component: Datav1Demo,
  updatedAt: '2026-09-08',
}

export default caseItem
