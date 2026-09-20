import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const SandstormThreeDemo = defineAsyncComponent(() => import('./SandstormThreeDemo.vue'))

const sandstormThreeCase: DemoCard = {
  id: 'sandstorm-three',
  title: 'Three.Quarks 沙尘暴 / 尘卷风',
  category: 'particles',
  description:
    '参考“沙尘暴 / 尘卷风”方案：贴地沙粒沿风向高速平流并受多层湍流扰动，形成流动沙幕；尘卷风用环形发射器叠加绕竖直轴的涡旋场与向上抽吸，塑造螺旋上升的漏斗。沙粒数、风速、湍流、涡旋半径/转速/抽吸与整体沙尘浓度均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 天气',
  component: SandstormThreeDemo,
  updatedAt: '2026-09-20'
}

export default sandstormThreeCase
