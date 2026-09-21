import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CosmicSolarWindDemo = defineAsyncComponent(() => import('./CosmicSolarWindDemo.vue'))

const cosmicSolarWindCase: DemoCard = {
  id: 'cosmic-solar-wind',
  title: 'VFX 行星级太阳风与磁层',
  category: 'particles',
  icon,
  description:
    '以真实地球为基底的行星尺度效果：外层弓激波、内层磁层顶构成双层半透明泪滴状空腔包裹地球，随太阳风动压与南向 Bz 收缩，太阳风粒子自日侧涌入、沿腔体外滑入磁尾；太阳风暴来袭时 CME 高密度壳层撞入，磁层被压缩、极区极光卵骤然增强。尺度以地球半径 Re 为基准，磁层顶约 10 Re、磁尾延伸数十 Re，相机位于数 Re 高度可见整个地球。太阳风速度/密度、Bz、Kp、磁层顶距离与磁尾长度、CME 强度/间隔、极光亮度与颜色均可实时调整',
  tag: 'Three.js, three.quarks, 空间天气, 行星尺度',
  component: CosmicSolarWindDemo,
  updatedAt: '2026-09-21'
}

export default cosmicSolarWindCase
