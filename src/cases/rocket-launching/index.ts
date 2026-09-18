import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const RocketLaunchingDemo = defineAsyncComponent(() => import('./RocketLaunchingDemo.vue'))

const rocketLaunchingCase: DemoCard = {
  id: 'rocket-launching',
  title: '运载火箭发射',
  category: 'scene',
  description: '基于 CZML 逐秒轨迹数据模拟运载火箭发射到入轨全过程',
  tag: 'CZML 轨迹',
  component: RocketLaunchingDemo,
  icon,
  updatedAt: '2026-09-06'
}

export default rocketLaunchingCase
