import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const GodrayThreeDemo = defineAsyncComponent(() => import('./GodrayThreeDemo.vue'))

const godrayThreeCase: DemoCard = {
  id: 'godray-three',
  title: 'VFX 丁达尔光柱',
  category: 'particles',
  icon,
  description:
    '以三片交叉的渐变光幕与太阳辉光构成晨昏光柱，光幕内部带流动的絮状噪声结构，配合缓慢摆动的整体姿态模拟大气折射；光柱体内散布大量缓慢浮沉、明暗闪烁的尘埃微粒，让空气具有可见的介质感。光柱高度/宽度、亮度/不透明度、噪声强度、尘埃数量/尺寸/不透明度、太阳高度角与光柱上下颜色均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 大气',
  component: GodrayThreeDemo,
  updatedAt: '2026-09-20'
}

export default godrayThreeCase
