import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const CfdVolumeDemo = defineAsyncComponent(() => import('./CfdVolumeDemo.vue'))

const cfdVolumeCase: DemoCard = {
  id: 'volume-cfd',
  title: '工程可视化-CFD 多物理场体',
  category: 'data',
  description:
    '把 CFD 单场表达升级为压力、速度、温度三变量联合体：Web Worker 以绕方块障碍物的势流近似解析生成三维多物理场，经多级瓦片 VoxelProvider 供给单个 VoxelPrimitive 做 GPU 光线步进，障碍物内部体素自动标记为无效。支持速度 / 压力 / 温度多变量切换与相适配色带、速度阈值分级（3/6/9 m/s）、值域与不透明度调节、任意方向剖切与切面导出、入射风速与热源温度调节、GPU 粒子流线与时间演化、屏幕误差与光线步长、最近邻采样，以及悬浮拾取各场数值。',
  tag: 'CFD 体渲染',
  updatedAt: '2026-09-28',
  component: CfdVolumeDemo
}

export default cfdVolumeCase
