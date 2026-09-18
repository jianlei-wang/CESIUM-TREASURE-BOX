import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const WeatherRainDemo = defineAsyncComponent(() => import('./WeatherRainDemo.vue'))
const weatherRainCase: DemoCard = {
  id: 'weather-rain',
  title: '天气特效-下雨',
  category: 'weather',
  description: '采用后处理的沉浸式雨景',
  tag: '天气系统',
  icon,
  component: WeatherRainDemo
}

export default weatherRainCase
