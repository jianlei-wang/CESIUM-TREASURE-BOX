import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const HelperBinocularsDemo = defineAsyncComponent(() => import('./HelperBinocularsDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-binoculars',
  title: '双筒望远镜',
  category: 'scene',
  description: '望远镜模式：拖动环视、滚轮变焦，可显示十字分划与测距',
  tag: '场景工具',
  icon,
  component: HelperBinocularsDemo,
  updatedAt: '2026-11-10'
}

export default caseItem
