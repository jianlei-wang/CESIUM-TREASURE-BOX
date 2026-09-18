import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const WaterReflectionDemo = defineAsyncComponent(() => import('./WaterReflectionDemo.vue'))
import icon from './icon.webp'

const waterReflectionCase: DemoCard = {
  id: 'water-reflection',
  title: '水面效果-Primitive真实倒影',
  category: 'water',
  description: '镜像虚拟相机渲染离屏反射纹理的动态水面',
  tag: '材质效果',
  component: WaterReflectionDemo,
  icon,
  updatedAt: '2026-08-25'
}

export default waterReflectionCase
