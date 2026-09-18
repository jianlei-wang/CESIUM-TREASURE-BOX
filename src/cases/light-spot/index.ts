import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightSpotDemo = defineAsyncComponent(() => import('./LightSpotDemo.vue'))

const lightSpotCase: DemoCard = {
  id: 'light-spot',
  title: '局部光源-聚光灯',
  category: 'lighting',
  description:
    '在点光源基础上增加锥形角度衰减：可调照射方位角、高度角、内锥角与外锥角，光斑大小与边缘柔度随内外锥角变化，配合影响范围、衰减指数与高光参数，实时呈现聚光灯照射效果',
  tag: '光照效果',
  icon,
  component: LightSpotDemo,
  updatedAt: '2026-09-12'
}

export default lightSpotCase
