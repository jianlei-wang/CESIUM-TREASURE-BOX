import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const GeoCloudsDemo = defineAsyncComponent(() => import('./GeoCloudsDemo.vue'))

const geoCloudsCase: DemoCard = {
  id: 'geo-clouds',
  title: '体积云 Raymarch',
  category: 'geo',
  description:
    'Weather 3D 分布烘焙 + 分层球壳体积 raymarch 云：多散射 Beer-Lambert 光照、级联阴影（BSM）云内自阴影、时域重建（Bayer 1/4 分迈 + velocity reprojection）与天气预设热切；云 overlay 线性域合成在大气链与 ACES 色调映射之间',
  tag: '体积云',
  icon: iconUrl,
  component: GeoCloudsDemo,
  updatedAt: '2026-09-04'
}

export default geoCloudsCase
