import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const SandstormDemo = defineAsyncComponent(() => import('./SandstormDemo.vue'))
const weatherSandstormCase: DemoCard = {
  id: 'weather-sandstorm',
  title: '天气特效-沙尘暴',
  category: 'weather',
  description: '全屏沙尘后处理，浓度/雾障/风向可调',
  tag: '天气系统',
  icon,
  component: SandstormDemo,
  updatedAt: '2026-09-07'
}

export default weatherSandstormCase
