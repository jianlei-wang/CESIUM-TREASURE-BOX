import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const GeologyVolumeDemo = defineAsyncComponent(() => import('./GeologyVolumeDemo.vue'))

const geologyVolumeCase: DemoCard = {
  id: 'volume-geology',
  title: '地质可视化-三维地层属性体',
  category: 'data',
  description:
    '统一构造场驱动的三维地层模型：地层倾斜、褶皱、断层错断与侵入体作用于同一场，岩性与孔隙率、渗透率、含水饱和度同源生成，经多级瓦片 VoxelProvider 交给单个 VoxelPrimitive 渲染。提供结构 / 岩性 / 属性 / 剖面 / 层位切片五种工作模式，叠加层位界面、断层面、钻孔柱状与深度标尺（标注随图层显隐）；支持六套地层逐层显隐、A-B 地质剖面绘制与导出、属性高值区与异常体等值面、分层统计、垂向夸张、双通道切换、任意剖切与体素拾取（岩性 / 属性 / 埋深）；全部参数均带悬停说明。',
  tag: '地层体渲染',
  icon: iconUrl,
  updatedAt: '2026-09-30',
  component: GeologyVolumeDemo
}

export default geologyVolumeCase
