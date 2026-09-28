import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const PointVoxelDemo = defineAsyncComponent(() => import('./PointVoxelDemo.vue'))

const pointVoxelCase: DemoCard = {
  id: 'point-voxel',
  title: '数据可视化-高性能体元素渲染',
  category: 'data',
  description:
    '根据模拟生成的空间点数据（x, y, z, value）自动生成高性能体元素进行体渲染：以空间哈希加速反距离加权插值，将离散采样点重建为规则体元素网格，并交给 VoxelPrimitive 单图元 GPU 光线步进渲染。支持采样点数、随机种子、网格分辨率、搜索半径、距离幂次、空体元素填充、色带、值域、透明度、步长、屏幕误差、最近邻采样与三向剖切等参数配置，鼠标悬浮拾取体元素位置与数值，并可叠加显示原始采样点云。',
  tag: '体元素渲染',
  icon,
  updatedAt: '2026-09-28',
  component: PointVoxelDemo
}

export default pointVoxelCase
