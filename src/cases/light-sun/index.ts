import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightSunDemo = defineAsyncComponent(() => import('./LightSunDemo.vue'))

const lightSunCase: DemoCard = {
  id: 'light-sun',
  title: '自定义光源-太阳光',
  category: 'lighting',
  description:
    '以 Cesium 原生 SunLight 作为全局主光源，光源方向由 viewer.clock.currentTime 自动驱动。支持日期、时刻滑杆与自动播放变速，实时观察日升日落过程中建筑白模与地形的受光变化，并可调节光源颜色、强度与 HDR 开关',
  tag: '光照效果',
  icon,
  component: LightSunDemo,
  updatedAt: '2026-09-12'
}

export default lightSunCase
