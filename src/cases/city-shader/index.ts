import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CityShaderDemo = defineAsyncComponent(() => import('./CityShaderDemo.vue'))

const CityShaderCase: DemoCard = {
  id: 'city-shader',
  title: '三维数据加载-城市建筑白模自定义着色器',
  category: 'effects',
  icon,
  description: '通过 CustomShader 片元着色器实现建筑高度渐变与动态扫描光带效果，参数实时可调',
  tag: '自定义着色器',
  component: CityShaderDemo,
  updatedAt: '2026-09-01'
}

export default CityShaderCase
