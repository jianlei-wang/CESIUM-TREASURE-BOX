import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const Tiles3DDayantaDemo = defineAsyncComponent(() => import('./Tiles3DDayantaDemo.vue'))
import icon from './icon.webp'

const tiles3DDayantaCase: DemoCard = {
  id: 'tiles-3d-dayanta',
  title: '3DTiles-大雁塔模型',
  category: 'tiles',
  description: '本地内置西安大雁塔 3D Tiles 模型，支持高度/透明度/着色/精度等参数调整',
  tag: '模型加载',
  icon,
  component: Tiles3DDayantaDemo
}

export default tiles3DDayantaCase
