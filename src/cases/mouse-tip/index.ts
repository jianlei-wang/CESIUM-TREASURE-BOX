import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const MouseTipDemo = defineAsyncComponent(() => import('./MouseTipDemo.vue'))
import icon from './icon.webp'

const mouseTipCase: DemoCard = {
  id: 'mouse-tip',
  title: '鼠标移动提示',
  category: 'scene',
  description: '跟随鼠标实时显示点位经纬度与高度',
  tag: '场景工具',
  component: MouseTipDemo,
  icon,
  updatedAt: '2026-08-24'
}

export default mouseTipCase
