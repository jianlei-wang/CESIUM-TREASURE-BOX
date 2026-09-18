import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const VectorLoaderDemo = defineAsyncComponent(() => import('./VectorLoaderDemo.vue'))
import icon from './icon.webp'

const vectorLoaderCase: DemoCard = {
  id: 'vector-loader',
  title: '本地矢量数据加载',
  category: 'tiles',
  description: '加载并展示 SHP / GeoJSON / KML 本地矢量数据',
  tag: '数据图层',
  icon,
  component: VectorLoaderDemo
}

export default vectorLoaderCase
