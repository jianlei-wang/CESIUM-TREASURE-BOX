import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'situation-plotting',
  title: '综合态势标绘控件',
  category: 'widgets',
  icon,
  description:
    '集成 21 种军事标绘几何绘制与文本、图片、模型三类点标注，点选后可移动/旋转/缩放并修改属性，支持 WGS84、Web墨卡托、北京54、西安80 等坐标系下的 GeoJSON / SHP 标准导出。',
  tag: '标绘标注导出',
  component: Demo,
  updatedAt: '2026-09-07'
}

export default caseItem
