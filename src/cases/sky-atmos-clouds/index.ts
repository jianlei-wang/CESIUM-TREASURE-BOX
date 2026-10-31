import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const SkyAtmosCloudsDemo = defineAsyncComponent(() => import('./SkyAtmosCloudsDemo.vue'))

const skyAtmosCloudsCase: DemoCard = {
  id: 'sky-atmos-clouds',
  title: '天气特效-体积云层',
  category: 'weather',
  description:
    '基于三层体积云与物理天气场构建天空云层：可分别调整每层云型、云底、厚度、密度与细节侵蚀，配合云量覆盖、风向风速和天空/地面补光，观察积云、高积云与卷云的层次过渡与实时变化。',
  tag: '天气系统',
  component: SkyAtmosCloudsDemo,
  updatedAt: '2026-10-31'
}

export default skyAtmosCloudsCase
