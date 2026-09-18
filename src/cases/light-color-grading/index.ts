import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightColorGradingDemo = defineAsyncComponent(() => import('./LightColorGradingDemo.vue'))

const lightColorGradingCase: DemoCard = {
  id: 'light-color-grading',
  title: '光照效果-颜色分级',
  category: 'lighting',
  description:
    '自定义 PostProcessStage 实现 ASC CDL 颜色分级：斜率、偏移、幂次三通道与饱和度、对比度、亮度实时可调，可快速营造暖调、冷调、高对比等电影级色调，支持一键预设切换',
  tag: '光照效果',
  icon,
  component: LightColorGradingDemo,
  updatedAt: '2026-09-12'
}

export default lightColorGradingCase
