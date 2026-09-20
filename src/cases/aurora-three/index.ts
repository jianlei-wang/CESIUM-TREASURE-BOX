import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const AuroraThreeDemo = defineAsyncComponent(() => import('./AuroraThreeDemo.vue'))

const auroraThreeCase: DemoCard = {
  id: 'aurora-three',
  title: 'Three.Quarks 极光',
  category: 'particles',
  description:
    '参考“极光”方案：以少量超大带状帘幕替代海量粒子，顶点着色器用多层正弦叠加调制褶皱与底部锐利边界，片元着色器叠加垂直射线并做上红下绿的高度分层着色，整体做缓慢东西向漂移与亮度脉动。帘幕数量、宽高、距离、亮度、相位速度、褶皱幅度与频率、上下颜色均可调整',
  tag: 'Three.js, three.quarks, 辉光, 极地',
  component: AuroraThreeDemo,
  updatedAt: '2026-09-20'
}

export default auroraThreeCase
