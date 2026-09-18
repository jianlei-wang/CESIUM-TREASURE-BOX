import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const MassCubesDemo = defineAsyncComponent(() => import('./MassCubesDemo.vue'))
import icon from './icon.webp'

const massCubesCase: DemoCard = {
  id: 'mass-cubes',
  title: '数据可视化-海量立方体',
  category: 'data',
  description: 'Primitive 实例化十万级至百万级随机立方体加载渲染',
  tag: '海量渲染',
  icon,
  component: MassCubesDemo
}

export default massCubesCase
