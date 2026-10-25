import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const SeismicResponseThreeDemo = defineAsyncComponent(() => import('./SeismicResponseThreeDemo.vue'))

const seismicResponseCase: DemoCard = {
  id: 'seismic-response-three',
  title: '地震作用与建筑动力响应',
  category: 'cesium-three',
  icon,
  description: '输入地面峰值加速度、频率和持续时间，楼层按模态形状做正弦响应并叠加衰减包络，展示顶层位移、层间位移角和峰值加速度；可切换一至三阶振型并观察变形曲线。',
  tag: 'Cesium + Three.js · 结构动力',
  component: SeismicResponseThreeDemo,
  updatedAt: '2026-10-23'
}

export default seismicResponseCase
