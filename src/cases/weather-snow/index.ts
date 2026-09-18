import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const WeatherSnowDemo = defineAsyncComponent(() => import('./WeatherSnowDemo.vue'))
const weatherSnowCase: DemoCard = {
  id: 'weather-snow',
  title: '天气特效-下雪',
  category: 'weather',
  description: '大范围雪花粒子飘落',
  tag: '天气系统',
  icon,
  component: WeatherSnowDemo
}

export default weatherSnowCase
