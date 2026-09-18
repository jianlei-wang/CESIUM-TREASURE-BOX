import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const FireParticlesDemo = defineAsyncComponent(() => import('./FireParticlesDemo.vue'))
import icon from './icon.webp'

const fireParticlesCase: DemoCard = {
  id: 'fire-particles',
  title: '火焰粒子-GPU计算',
  category: 'particles',
  description: 'GPU 粒子系统实时模拟火焰喷射',
  tag: '粒子系统',
  component: FireParticlesDemo,
  icon,
  updatedAt: '2026-08-23'
}

export default fireParticlesCase
