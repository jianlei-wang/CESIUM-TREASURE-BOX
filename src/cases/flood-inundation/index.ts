import { defineAsyncComponent } from 'vue'
import icon from './icon.webp'

const FloodInundationDemo = defineAsyncComponent(() => import('./FloodInundationDemo.vue'))

export default {
  id: 'flood-inundation',
  title: '洪水淹没模拟',
  icon,
  category: 'water',
  description: '以 1024×1024 高程深度图映射至西藏那曲 30km×51km 区域，以 GPU 双缓冲流体模拟叠加光线步进水渲染，支持鼠标选取水源点、水闸设置与流体参数实时调节',
  tag: '流体模拟',
  component: FloodInundationDemo
}
