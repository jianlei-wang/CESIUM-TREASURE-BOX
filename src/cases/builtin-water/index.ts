import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const BuiltinWaterDemo = defineAsyncComponent(() => import('./BuiltinWaterDemo.vue'))
import icon from './icon.webp'

const builtinWaterCase: DemoCard = {
  id: 'builtin-water',
  title: '水面效果-Cesium内置材质',
  category: 'water',
  description: '使用 Cesium 内置 Water 材质生成动态水面',
  tag: '材质效果',
  component: BuiltinWaterDemo,
  icon,
  updatedAt: '2026-08-23'
}

export default builtinWaterCase
