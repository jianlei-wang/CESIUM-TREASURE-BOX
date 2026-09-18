import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CityStyleShaderDemo = defineAsyncComponent(() => import('./CityStyleShaderDemo.vue'))

const CityStyleShaderCase: DemoCard = {
  id: 'city-style-shader',
  title: '三维数据加载-城市建筑白模样式+着色器',
  category: 'effects',
  icon,
  description: 'Cesium3DTileStyle 按建筑体量分级设色，叠加 CustomShader 边缘光与高度渐变亮度',
  tag: '样式着色',
  component: CityStyleShaderDemo,
  updatedAt: '2026-09-01'
}

export default CityStyleShaderCase
