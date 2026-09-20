import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const ThunderstormThreeDemo = defineAsyncComponent(() => import('./ThunderstormThreeDemo.vue'))

const thunderstormThreeCase: DemoCard = {
  id: 'thunderstorm-three',
  title: 'Three.Quarks 雷暴积雨云',
  category: 'particles',
  description:
    '参考“雷暴积雨云 + 闪电链”方案：多层烟雾 billboard 叠出云砧体积感，向上浮力与水平风平流驱动云体，递归分叉的折线闪电按随机节奏劈落并伴随辉光闪白，下方雨幕受重力与风拖曳。云量、云高、上升力、风力、雨量、闪电间隔与分叉级数均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 天气',
  component: ThunderstormThreeDemo,
  updatedAt: '2026-09-20'
}

export default thunderstormThreeCase
