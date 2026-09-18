import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const EarthRotationDemo = defineAsyncComponent(() => import('./EarthRotationDemo.vue'))
import icon from './icon.webp'

const earthRotationCase: DemoCard = {
  id: 'earth-rotation',
  title: '地球自转',
  category: 'scene',
  description: '采用 ICRF 惯性参考系实现地球自转与轨道观察',
  tag: '场景工具',
  component: EarthRotationDemo,
  icon,
  updatedAt: '2026-08-26'
}

export default earthRotationCase
