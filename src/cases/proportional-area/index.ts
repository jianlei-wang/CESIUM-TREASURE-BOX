import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const component = defineAsyncComponent(() => import('./ProportionalAreaDemo.vue'))

const proportionalAreaCase: DemoCard = {
  id: 'proportional-area',
  title: '空间分析-比例符号面',
  category: 'analysis',
  description: '比例符号面：以面符号的面积或半径表示数值属性（面积正比/半径正比），支持比例系数、范围钳制、样式与标签等参数设定',
  tag: '缓冲区',
  icon,
  component,
  updatedAt: '2026-08-30'
}

export default proportionalAreaCase
