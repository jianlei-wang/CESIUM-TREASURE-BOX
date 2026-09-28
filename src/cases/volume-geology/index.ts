import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const GeologyVolumeDemo = defineAsyncComponent(() => import('./GeologyVolumeDemo.vue'))

const geologyVolumeCase: DemoCard = {
  id: 'volume-geology',
  title: '地质可视化-三维地层属性体',
  category: 'data',
  description:
    '在层状地层体素基础上扩展连续属性通道：Web Worker 按层状接触面与侵入体解析生成 6 类岩性分类体，并派生出孔隙率、渗透率、饱和度三套工程属性场，经多级瓦片 VoxelProvider 交给单个 VoxelPrimitive 渲染。支持岩性（分类色板）与属性（连续色带）双通道切换、地层起伏幅度与侵入体规模调节、任意方向剖切与切面导出、属性值域与不透明度调节、最近邻采样、屏幕误差与光线步长，以及悬浮拾取岩性分类或属性数值。',
  tag: '地层体渲染',
  updatedAt: '2026-09-28',
  component: GeologyVolumeDemo
}

export default geologyVolumeCase
