import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const FluidSphDemo = defineAsyncComponent(() => import('./FluidSphDemo.vue'))

const fluidSphCase: DemoCard = {
  id: 'fluid-sph',
  title: 'SPH 地形流体模拟',
  category: 'water',
  description:
    '以 GPU 端 SPH 粒子与光滑核函数求解压力、重力与边界约束，多缓冲逐帧推进水位场，水流沿真实地形扩散汇聚成湖，支持实时移动水源并调节重力、水量与渲染质量',
  tag: '流体模拟',
  icon,
  component: FluidSphDemo
}

export default fluidSphCase
