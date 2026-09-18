import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const MouseInfoDemo = defineAsyncComponent(() => import('./MouseInfoDemo.vue'))
import icon from './icon.webp'

const mouseInfoCase: DemoCard = {
  id: 'mouse-info',
  title: '鼠标位置-坐标与比例尺',
  category: 'scene',
  description: '实时显示鼠标位置经纬度、海拔、缩放层级与比例尺',
  tag: '场景工具',
  component: MouseInfoDemo,
  icon,
  updatedAt: '2026-08-23'
}

export default mouseInfoCase
