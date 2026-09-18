import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightTonemappingDemo = defineAsyncComponent(() => import('./LightTonemappingDemo.vue'))

const lightTonemappingCase: DemoCard = {
  id: 'light-tonemapping',
  title: '光照效果-HDR 色调映射',
  category: 'lighting',
  description:
    '开启 HDR 渲染缓冲后可支持超过 1.0 的光照强度，再经色调映射压缩到显示范围。支持 PBR Neutral、ACES、Filmic、Reinhard 与 Modified Reinhard 五种映射器实时切换，并配合平行光强度观察不同映射器的色彩与高光表现',
  tag: '光照效果',
  icon,
  component: LightTonemappingDemo,
  updatedAt: '2026-09-12'
}

export default lightTonemappingCase
