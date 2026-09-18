import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const LightningDemo = defineAsyncComponent(() => import('./LightningDemo.vue'))
const lightningCase: DemoCard = {
  id: 'lightning',
  title: '天气特效-闪电',
  category: 'weather',
  description: '程序化雷电路径与云层辉光',
  tag: '天气系统',
  icon,
  component: LightningDemo
}

export default lightningCase
