import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const ExplosionParticlesDemo = defineAsyncComponent(() => import('./ExplosionParticlesDemo.vue'))
import icon from './icon.webp'

const explosionParticlesCase: DemoCard = {
  id: 'explosion-particles',
  title: '爆炸粒子-GPU计算',
  category: 'particles',
  description: 'GPU 粒子系统实时模拟爆炸冲击飞散',
  tag: '粒子系统',
  component: ExplosionParticlesDemo,
  icon,
  updatedAt: '2026-08-23'
}

export default explosionParticlesCase
