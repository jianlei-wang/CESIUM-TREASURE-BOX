import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const WindFieldThreeDemo = defineAsyncComponent(() => import('./WindFieldThreeDemo.vue'))

const windFieldThreeCase: DemoCard = {
  id: 'wind-field-three',
  title: 'Three.Quarks 全球风场可视化',
  category: 'particles',
  description:
    '参考“全球风场可视化”方案：海量短拖尾粒子在程序化矢量风场中平流，寿命到期后原地重生以保持总数恒定，形成流动的“风之河”；矢量场叠加多层低频风带、高频湍流与台风式涡旋，速度映射到蓝→绿→黄→红的色带。粒子数、区域范围、风速、湍流、寿命、拖尾长度、涡旋强度/半径、高度与厚度、亮度均可调整',
  tag: 'Three.js, three.quarks, 风场, 数据可视化',
  component: WindFieldThreeDemo,
  updatedAt: '2026-09-20'
}

export default windFieldThreeCase
