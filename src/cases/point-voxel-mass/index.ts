import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const MassVoxelDemo = defineAsyncComponent(() => import('./MassVoxelDemo.vue'))

const massVoxelCase: DemoCard = {
  id: 'point-voxel-mass',
  title: '数据可视化-高性能海量体元素渲染',
  category: 'data',
  icon,
  description:
    '面向海量离散点数据的体元素流式渲染案例：在 Web Worker 中用纯 TypedArray 的 CSR 扁平空间哈希对采样点建立索引，按环形 K 近邻与反距离加权（IDW）将点数据实时重建为规则体数据，并以八叉树多级瓦片（tileSize³ / 多级 LOD）组织，通过 VoxelProvider.requestData 按屏幕误差流式供给单个 VoxelPrimitive 做 GPU 光线步进渲染。支持采样点数、随机种子、分辨率预设（128³/192³/256³）、K 近邻数、搜索半径、距离幂次、空体元素填充、可分离高斯平滑、传递函数色带（Viridis/Turbo/冷暖/地形/彩虹/Jet）、值域、不透明度、覆盖基底、步长、屏幕误差、最近邻采样与任意方向剖切等参数；剖切采用拖动低分辨率、松开高分辨率的持久化 Canvas 预览，开启 requestRenderMode 按需渲染，鼠标悬浮拾取体元素数值，并可叠加显示原始点云。',
  tag: '体元素渲染',
  updatedAt: '2026-09-28',
  component: MassVoxelDemo
}

export default massVoxelCase
