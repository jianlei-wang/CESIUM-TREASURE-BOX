import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const WindVolumeDemo = defineAsyncComponent(() => import('./WindVolumeDemo.vue'))

const windVolumeCase: DemoCard = {
  id: 'volume-wind',
  title: '气象可视化-三维风场向量体',
  category: 'data',
  description:
    '从只看粒子的风场升级为真正的三维向量体：在 Web Worker 中按基础风、风切变、涡旋与阵风解析生成三维向量场，同时提供体标量（风速 / 垂直速度）与 GPU 粒子两种表达。风速/垂直速度通道经传递函数映射颜色，涡旋与阵风结构清晰可辨；支持风速（5/10/15 m/s）阈值分级、值域与不透明度调节、基础风速与涡旋数调节、粒子数与粒子尺寸调节、任意方向剖切与切面导出、屏幕误差与光线步长、最近邻采样以及鼠标悬浮拾取矢量速度。',
  tag: '向量体渲染',
  updatedAt: '2026-09-28',
  component: WindVolumeDemo
}

export default windVolumeCase
