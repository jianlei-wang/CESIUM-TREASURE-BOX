import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightRectDemo = defineAsyncComponent(() => import('./LightRectDemo.vue'))

const lightRectCase: DemoCard = {
  id: 'light-rect',
  title: '局部光源-矩形面光源',
  category: 'lighting',
  description:
    '采用 Lambert 多边形积分（Drobot 2014）近似矩形面光源：可调矩形朝向、宽度、高度、颜色、强度与环境光，面光源的柔和投光与大面积漫反射效果实时可调，适用于室内补光与展陈布光',
  tag: '光照效果',
  icon,
  component: LightRectDemo,
  updatedAt: '2026-09-12'
}

export default lightRectCase
