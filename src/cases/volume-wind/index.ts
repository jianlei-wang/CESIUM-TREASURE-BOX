import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const WindVolumeDemo = defineAsyncComponent(() => import('./WindVolumeDemo.vue'))

const windVolumeCase: DemoCard = {
  id: 'volume-wind',
  title: '气象可视化-三维风场向量体',
  category: 'data',
  description:
    '三维风场向量分析工作台：主线程 GPGPU 风流粒子层（WebGL2 三维纹理 + 纹理乒乓）与 Web Worker 标量体、流线、廓线共享同一套 u/v/w 参数化（基础风、风切变、涡旋、阵风），按气象「来向」语义定义主导风向。提供多高度分层、双向 RK4 积分与速度渐变尾迹的三维流线，沿主导风向的垂直风剖面与任意高度层箭头，体域线框/地面网格/高度刻度/风向罗盘/地面风场 footprint 等空间骨架；支持点击场景放置垂直廓线、悬浮读取 u/v/w，风向与风切变 HUD，六种相机预设、三种场景背景、风速阈值分级与密度压缩调节。',
  tag: '向量体渲染',
  icon: iconUrl,
  updatedAt: '2026-10-01',
  component: WindVolumeDemo
}

export default windVolumeCase
