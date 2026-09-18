import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightPointDemo = defineAsyncComponent(() => import('./LightPointDemo.vue'))

const lightPointCase: DemoCard = {
  id: 'light-point',
  title: '局部光源-点光源',
  category: 'lighting',
  description:
    '通过 CustomShader 在片元着色器中手动实现点光源：位置、颜色、强度、影响范围与衰减指数实时可调，叠加 Lambert 漫反射与 Blinn-Phong 高光，并配合半球环境光抑制死黑；光源位置以发光点标记，直观观察距离衰减',
  tag: '光照效果',
  icon,
  component: LightPointDemo,
  updatedAt: '2026-09-12'
}

export default lightPointCase
