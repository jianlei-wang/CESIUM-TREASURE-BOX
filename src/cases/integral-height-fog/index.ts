import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const IntegralHeightFogDemo = defineAsyncComponent(() => import('./IntegralHeightFogDemo.vue'))
import icon from './icon.webp'

const integralHeightFogCase: DemoCard = {
  id: 'integral-height-fog',
  title: '天气特效-浓度积分高度雾',
  category: 'weather',
  description: '使用线性与指数浓度积分计算高度雾',
  tag: '天气系统',
  component: IntegralHeightFogDemo,
  icon
}

export default integralHeightFogCase
