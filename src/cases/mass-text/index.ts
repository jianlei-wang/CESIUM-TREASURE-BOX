import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const MassTextDemo = defineAsyncComponent(() => import('./MassTextDemo.vue'))
import icon from './icon.webp'

const massTextCase: DemoCard = {
  id: 'mass-text',
  title: '数据可视化-海量文字',
  category: 'data',
  description: 'BillboardCollection 十万级至百万级随机文字标记加载渲染',
  tag: '海量渲染',
  icon,
  component: MassTextDemo
}

export default massTextCase
