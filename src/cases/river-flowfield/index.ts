import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const RiverFlowfieldDemo = defineAsyncComponent(() => import('./RiverFlowfieldDemo.vue'))

const riverFlowfieldCase: DemoCard = {
  id: 'river-flowfield',
  title: '河道流场水面',
  category: 'water',
  icon: iconUrl,
  description:
    '以真实河道水面多边形与中心线烘焙流场贴图，GPU 着色器沿流场驱动波纹流动、泡沫聚集与岸线羽化，深浅双色、菲涅尔与屏幕空间高光抗锯齿一体成型，支持叠加流向箭头粒子并实时调节全套参数',
  tag: '河道水流',
  component: RiverFlowfieldDemo,
  updatedAt: '2026-09-04'
}

export default riverFlowfieldCase
