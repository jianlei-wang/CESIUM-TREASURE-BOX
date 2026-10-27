import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const SoftVolumeThreeDemo = defineAsyncComponent(() => import('./SoftVolumeThreeDemo.vue'))

const softVolumeCase: DemoCard = {
  id: 'soft-volume-three',
  title: '软体体积落体与地面形变',
  category: 'cesium-three',
  description: '球形、块形或长梁形软体由三维质点阵与邻域约束构成，从设定高度下落，触地后发生局部压缩与整体回弹；可调形状、落差、点阵分辨率、刚度、质量与恢复系数。',
  tag: 'Cesium + Three.js · 软体形变',
  icon,
  component: SoftVolumeThreeDemo,
  updatedAt: '2026-10-26'
}

export default softVolumeCase
