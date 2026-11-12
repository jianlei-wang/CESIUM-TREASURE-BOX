import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const EntropyHaloDemo = defineAsyncComponent(() => import('./EntropyHaloDemo.vue'))
import icon from './icon.webp'

const entropyHaloCase: DemoCard = {
  id: 'geo-entropy-halo',
  title: '三维特效-结构熵光晕描边',
  category: 'effects',
  description:
    '以卷帘方式左右对比场景处理前后差异：左侧保持原始画面，右侧叠加结构熵光晕效果。响应由亮度梯度、局部纹理离散度与深度跃变融合而成，俯视、斜视与平视都能稳定描边，支持拖动卷帘位置、半径、增益、阈值与着色调节，并可切换仅描边模式。',
  tag: '后处理, 熵, 光晕, 卷帘对比',
  component: EntropyHaloDemo,
  icon,
  updatedAt: '2026-11-12'
}

export default entropyHaloCase
