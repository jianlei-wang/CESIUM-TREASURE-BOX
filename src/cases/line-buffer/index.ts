import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const LineBufferDemo = defineAsyncComponent(() => import('./LineBufferDemo.vue'))
import icon from './icon.webp'

const lineBufferCase: DemoCard = {
  id: 'line-buffer',
  title: '空间分析-线缓冲区分析',
  category: 'analysis',
  description: '动态绘制折线，按缓冲值(m)生成缓冲区，支持圆角/方角端点与拐角',
  tag: '缓冲区',
  icon,
  component: LineBufferDemo,
  updatedAt: '2026-08-26'
}

export default lineBufferCase
