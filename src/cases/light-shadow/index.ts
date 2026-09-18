import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightShadowDemo = defineAsyncComponent(() => import('./LightShadowDemo.vue'))

const lightShadowCase: DemoCard = {
  id: 'light-shadow',
  title: '光照效果-实时阴影',
  category: 'lighting',
  description:
    '基于 Cesium 原生 ShadowMap 的实时阴影：支持阴影总开关、浓度、软阴影（PCF）、最大距离、贴图尺寸、法线偏移与边缘淡出等参数调节，并可通过平行光方位角/高度角控制阴影方向，观察建筑白模在日照下的投影变化',
  tag: '光照效果',
  icon,
  component: LightShadowDemo,
  updatedAt: '2026-09-12'
}

export default lightShadowCase
