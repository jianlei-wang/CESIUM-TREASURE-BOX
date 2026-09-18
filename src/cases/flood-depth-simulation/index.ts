import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const FloodDepthSimulationDemo = defineAsyncComponent(() => import('./FloodDepthSimulationDemo.vue'))

const floodDepthSimulationCase: DemoCard = {
  id: 'flood-depth-simulation',
  title: '深度图洪水模拟',
  category: 'water',
  icon,
  description: '手动输入四至或框选范围，采样真实地形生成深度图，选择出水点后执行 GPU 洪水淹没模拟，支持流体参数与水闸设定',
  tag: '流体模拟',
  component: FloodDepthSimulationDemo
}

export default floodDepthSimulationCase
