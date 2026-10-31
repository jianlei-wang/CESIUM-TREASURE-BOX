import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const HelperWeatherDemo = defineAsyncComponent(() => import('./HelperWeatherDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-weather',
  title: '雷达天气',
  category: 'weather',
  description: 'MeteoSwiss 雷达降雨、云层与闪电，含空间化雷声，可按时次回放',
  tag: '天气特效',
  component: HelperWeatherDemo,
  updatedAt: '2026-10-30'
}

export default caseItem
