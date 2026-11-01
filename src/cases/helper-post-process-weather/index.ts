import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const HelperPostProcessWeatherDemo = defineAsyncComponent(() => import('./HelperPostProcessWeatherDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-post-process-weather',
  title: '天气-雪线雾与雷雨特效',
  category: 'effects',
  description: '雪线、山谷雾、降水、雨圈与闪电五种天气向屏幕空间特效：可调海拔与坡度形成雪线过渡，用雾顶与浓度控制山谷层雾，并叠加雨雪、地面雨圈与云底闪电。',
  tag: '后期特效',
  icon,
  component: HelperPostProcessWeatherDemo,
  updatedAt: '2026-11-01'
}

export default caseItem
