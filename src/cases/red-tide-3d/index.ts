import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const RedTideDemo = defineAsyncComponent(() => import('./RedTideDemo.vue'))

const redTideCase: DemoCard = {
  id: 'red-tide-3d',
  title: '赤潮监测三维模拟仿真系统',
  category: 'system',
  description:
    '面向近岸海域赤潮监测的三维模拟仿真系统：以 Cesium 1.144 地球场景叠加 Three.js 体渲染，通过欧拉平流—扩散—生长模型驱动富营养化藻华演变；采用综合总览 / 仿真推演 / 模型参数 / 科研分析 / 监测站点五级一级菜单分页组织，配合常驻图层面板与图例面板，避免信息堆叠；支持三维赤潮体 / 表层浓度场 / 海流粒子多图层联动，体 / 等值面 / 混合三种科研表达、垂向剖切与 X/Y 分析剖面、深度遮挡复合管线；提供监测浮标观测参数、最大浓度与影响面积演化曲线、影响体积 / 面积 / 深度统计，并支持 GPU GPGPU 与 Web Worker 双计算后端、72 小时时间轴推演与速度调节。',
  tag: '海洋立体仿真',
  icon: iconUrl,
  updatedAt: '2026-10-05',
  component: RedTideDemo
}

export default redTideCase
