import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightAtmosphereDemo = defineAsyncComponent(() => import('./LightAtmosphereDemo.vue'))

const lightAtmosphereCase: DemoCard = {
  id: 'light-atmosphere',
  title: '光照效果-大气动态光照',
  category: 'lighting',
  description:
    '开启 globe.dynamicAtmosphereLighting 后地球与大气随太阳方向动态受光，可通过时间滑块与时间倍率驱动昼夜更替，并实时调节太阳光强度、大气光强度、Mie 各向异性与大气色调偏移',
  tag: '光照效果',
  icon,
  component: LightAtmosphereDemo,
  updatedAt: '2026-09-12'
}

export default lightAtmosphereCase
