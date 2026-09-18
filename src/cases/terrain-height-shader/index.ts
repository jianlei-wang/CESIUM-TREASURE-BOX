import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const terrainHeightShaderCase: DemoCard = {
  id: 'terrain-height-shader',
  title: '空间分析-地形高度场·派生着色器',
  category: 'analysis',
  description: '对 GLOBE pass 片元着色器做派生，正交相机顶视渲染到浮点 FBO，数百毫秒提取当前渲染 LOD',
  tag: '空间分析',
  icon,
  component: Demo
}

export default terrainHeightShaderCase
