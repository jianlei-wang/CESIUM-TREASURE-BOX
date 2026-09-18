import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const ExplosionBoomDemo = defineAsyncComponent(() => import('./ExplosionBoomDemo.vue'))
import icon from './icon.webp'

const explosionBoomCase: DemoCard = {
  id: 'explosion-boom',
  title: '爆炸特效-噪声云团',
  category: 'particles',
  description: '屏幕空间 fbm 噪声云团爆炸与色彩渐变',
  tag: '着色器特效',
  component: ExplosionBoomDemo,
  icon,
  updatedAt: '2026-08-24'
}

export default explosionBoomCase
