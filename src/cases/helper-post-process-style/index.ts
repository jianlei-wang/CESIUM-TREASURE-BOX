import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const HelperPostProcessStyleDemo = defineAsyncComponent(() => import('./HelperPostProcessStyleDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-post-process-style',
  title: '风格-手绘红外与胶片',
  category: 'effects',
  description: 'Dufour 手绘地图、色彩隔离、红外、特艺彩色与超 8 胶片五种成像风格：用笔触与斜射光生成手绘底图，再用色相隔离、伪彩与颗粒漏光切换复古影调。',
  tag: '后期特效',
  icon,
  component: HelperPostProcessStyleDemo,
  updatedAt: '2026-11-01'
}

export default caseItem
