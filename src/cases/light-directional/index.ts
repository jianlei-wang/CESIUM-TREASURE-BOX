import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightDirectionalDemo = defineAsyncComponent(() => import('./LightDirectionalDemo.vue'))

const lightDirectionalCase: DemoCard = {
  id: 'light-directional',
  title: '自定义光源-平行光',
  category: 'lighting',
  description:
    '以 Cesium 原生 DirectionalLight 作为全局主光源，方向、颜色、强度完全人工可控。支持方位角、高度角、颜色与强度实时调节，观察建筑白模明暗面随光照方向连续变化，并可叠加地形光照与 HDR',
  tag: '光照效果',
  icon,
  component: LightDirectionalDemo,
  updatedAt: '2026-09-12'
}

export default lightDirectionalCase
