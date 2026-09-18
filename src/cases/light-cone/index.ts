import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightConeDemo = defineAsyncComponent(() => import('./LightConeDemo.vue'))

const LightConeCase: DemoCard = {
  id: 'light-cone',
  title: '三维特效-光锥图元',
  category: 'effects',
  icon,
  description: '光锥图元，由底部圆环、旋转扫描圆、渐隐光柱与上升粒子组成，支持尺寸与颜色实时调节',
  tag: '光锥图元',
  component: LightConeDemo,
  updatedAt: '2026-09-01'
}

export default LightConeCase
