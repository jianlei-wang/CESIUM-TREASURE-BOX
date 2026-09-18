import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CityPointLightDemo = defineAsyncComponent(() => import('./CityPointLightDemo.vue'))

const CityPointLightCase: DemoCard = {
  id: 'city-point-light',
  title: '三维数据加载-城市建筑白模点光源效果',
  category: 'effects',
  icon,
  description: 'CustomShader 实现 Blinn-Phong 点光源照明，光源位置、颜色、强度与衰减参数实时可调',
  tag: '点光源',
  component: CityPointLightDemo,
  updatedAt: '2026-09-01'
}

export default CityPointLightCase
