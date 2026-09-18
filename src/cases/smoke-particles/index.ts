import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const SmokeParticlesDemo = defineAsyncComponent(() => import('./SmokeParticlesDemo.vue'))
import icon from './icon.webp'

const smokeParticlesCase: DemoCard = {
  id: 'smoke-particles',
  title: '烟雾粒子-GPU计算',
  category: 'particles',
  description: 'GPU 粒子系统实时模拟烟雾升腾扩散',
  tag: '粒子系统',
  component: SmokeParticlesDemo,
  icon,
  updatedAt: '2026-08-23'
}

export default smokeParticlesCase
