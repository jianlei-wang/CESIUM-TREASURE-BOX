import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const WindFieldThreeDemo = defineAsyncComponent(() => import('./WindFieldThreeDemo.vue'))

const windFieldThreeCase: DemoCard = {
  id: 'wind-field-three',
  title: 'VFX 全球风场可视化',
  category: 'particles',
  icon,
  description:
    '海量短拖尾粒子在无散度矢量风场中平流，寿命到期后原地重生以保持总数恒定，形成流动的“风之河”。风场由多尺度流函数涡旋（u=∂ψ/∂z、w=-∂ψ/∂x，保证不可压）叠加纬向急流带与近似 Rankine 气旋切向风构成，并按高度施加风速切变；粒子采用中点积分保证轨迹平滑，拖尾用时间常数连续逼近，速度映射到深蓝→青→绿→黄→橙→红的色带。风场在粗网格上采样、粒子经双线性插值读取，逐粒子开销大幅降低。粒子数、区域范围、风速、湍流、寿命、拖尾长度、气旋强度/半径、高度与厚度、亮度均可调整',
  tag: 'Three.js, three.quarks, 风场, 数据可视化',
  component: WindFieldThreeDemo,
  updatedAt: '2026-09-20'
}

export default windFieldThreeCase
