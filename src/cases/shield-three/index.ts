import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const ShieldThreeDemo = defineAsyncComponent(() => import('./ShieldThreeDemo.vue'))

const shieldThreeCase: DemoCard = {
  id: 'shield-three',
  title: 'VFX 能量护盾',
  category: 'particles',
  icon,
  description:
    '半球护盾以自定义着色器绘制滚动网格与菲涅尔边缘辉光，命中点在球面触发扩散涟漪并抛射电弧火花，涟漪以环状网格向外扩张；球面持续有能量微粒上升，营造电离气体流动感。半径、网格密度/滚动速度、辉光强度/不透明度、命中间隔与强度、电弧火花数/尺寸、能量微粒量、护盾颜色均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 科幻',
  component: ShieldThreeDemo,
  updatedAt: '2026-09-20'
}

export default shieldThreeCase
