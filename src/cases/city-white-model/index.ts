import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CityWhiteModelDemo = defineAsyncComponent(() => import('./CityWhiteModelDemo.vue'))

const CityWhiteModelCase: DemoCard = {
  id: 'city-white-model',
  title: '三维数据加载-城市建筑白模',
  category: 'effects',
  icon,
  description: '加载荷兰全境建筑白模 3D Tiles 数据，支持 LOD 精度切换与渲染、性能参数实时调节',
  tag: '城市白模',
  component: CityWhiteModelDemo,
  updatedAt: '2026-09-01'
}

export default CityWhiteModelCase
