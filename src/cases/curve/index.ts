import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'curve',
  title: '曲线-平滑贝塞尔曲线',
  category: 'draw',
  description: '左键逐点采样、右键结束，自动生成平滑曲线；支持颜色、线宽与不透明度实时调整。',
  tag: '线绘制',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
