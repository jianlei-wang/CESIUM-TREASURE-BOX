import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CosmicSonarDemo = defineAsyncComponent(() => import('./CosmicSonarDemo.vue'))

const cosmicSonarCase: DemoCard = {
  id: 'cosmic-sonar',
  title: 'VFX 声呐扫描波',
  category: 'particles',
  icon,
  description:
    '以深水介质与海底散射噪声构成水下空间，主动声呐以锥形脉冲向外推进、前沿最亮、后方按双程衰减留余辉；波前扫过海底时留下扇形多波束覆盖条带，命中目标时产生随距离衰减的回波闪亮，并有大量悬浮的海洋雪缓缓下沉。脉冲间隔/推进速度、波束张角、水体浑浊度、海雪密度、回波强度、目标距离、海底深度与颜色均可实时调整',
  tag: 'Three.js, three.quarks, 水下探测, 声呐',
  component: CosmicSonarDemo,
  updatedAt: '2026-09-21'
}

export default cosmicSonarCase
