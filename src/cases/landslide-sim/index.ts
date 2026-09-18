import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LandslideSimDemo = defineAsyncComponent(() => import('./LandslideSimDemo.vue'))

const landslideSimCase: DemoCard = {
  id: 'landslide-sim',
  title: '滑坡动态模拟',
  category: 'analysis',
  description: '基于 Cesium World Terrain 真实高程与深度积分浅水波方程（SWE）的滑坡运动模拟：源区圈定、Voellmy 摩擦、方量守恒、影响范围提取与 GeoJSON/KML 导出',
  tag: 'SWE, 滑坡',
  icon,
  component: LandslideSimDemo,
  updatedAt: '2026-09-10'
}

export default landslideSimCase
