import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const DrawExportDemo = defineAsyncComponent(() => import('./DrawExportDemo.vue'))
const drawExportCase: DemoCard = {
  id: 'draw-export',
  title: '标记标绘-点线面绘制与导出',
  category: 'draw',
  description: '在地图上绘制点、线、面图形，支持导出 GeoJSON 与 SHP 文件，可选 WGS84/Web墨卡托/北京54/西安80 坐标系，多类型自动打包压缩',
  tag: '标绘导出',
  icon,
  component: DrawExportDemo,
  updatedAt: '2026-08-27'
}

export default drawExportCase
