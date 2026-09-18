import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const UndergroundDemo = defineAsyncComponent(() => import('./UndergroundDemo.vue'))

const undergroundModeCase: DemoCard = {
  id: 'underground-mode',
  title: '地下模式-地铁站',
  category: 'scene',
  description: '地球半透明地下模式，查看埋设于地表下方的地铁站模型',
  tag: '地下可视化',
  icon,
  component: UndergroundDemo,
  updatedAt: '2026-09-06'
}

export default undergroundModeCase
