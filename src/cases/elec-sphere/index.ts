import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const ElecSphereDemo = defineAsyncComponent(() => import('./ElecSphereDemo.vue'))

const ElecSphereCase: DemoCard = {
  id: 'elec-sphere',
  title: '三维特效-电弧球体',
  category: 'effects',
  icon,
  description: '电弧闪烁球体，支持颜色、透明度、闪烁速度与 XYZ 半径实时调节，可点击地图定位',
  tag: '电弧球体',
  component: ElecSphereDemo,
  updatedAt: '2026-09-01'
}

export default ElecSphereCase
