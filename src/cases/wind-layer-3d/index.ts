import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const WindLayer3DDemo = defineAsyncComponent(() => import('./WindLayer3DDemo.vue'))
import icon from './icon.webp'

const windLayer3dCase: DemoCard = {
  id: 'wind-layer-3d',
  title: '三维风场-WebGL2&GPU效果',
  category: 'weather',
  description: 'GPU 计算风场粒子流线与自定义四至生成',
  tag: '风场粒子',
  component: WindLayer3DDemo,
  icon,
  updatedAt: '2026-08-23'
}

export default windLayer3dCase
