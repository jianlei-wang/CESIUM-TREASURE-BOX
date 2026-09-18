import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const FogDemo = defineAsyncComponent(() => import('./FogDemo.vue'))
import icon from './icon.webp'

const fogCase: DemoCard = {
  id: 'weather-fog',
  title: '天气特效-深度高度雾',
  category: 'weather',
  description: '采用深度与高度驱动的动态体积雾',
  tag: '天气系统',
  component: FogDemo,
  icon
}

export default fogCase
