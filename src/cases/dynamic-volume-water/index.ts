import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const VolumeWaterDemo = defineAsyncComponent(() => import('./VolumeWaterDemo.vue'))
import iconUrl from './icon.webp'

const dynamicVolumeWaterCase: DemoCard = {
  id: 'dynamic-volume-water',
  title: '水面效果-动态体积水',
  category: 'water',
  description: '指定多边形/矩形构建几何位移的动态体积水面',
  tag: '材质效果',
  icon: iconUrl,
  component: VolumeWaterDemo,
  updatedAt: '2026-08-26'
}

export default dynamicVolumeWaterCase
