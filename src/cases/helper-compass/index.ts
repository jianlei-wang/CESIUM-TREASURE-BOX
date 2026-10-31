import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const HelperCompassDemo = defineAsyncComponent(() => import('./HelperCompassDemo.vue'))

const helperCompassCase: DemoCard = {
  id: 'helper-compass',
  title: '指南针控件',
  category: 'widgets',
  description: '罗盘控件，点击指北、拖动旋转视角，随相机朝向实时转动',
  tag: '界面控件',
  component: HelperCompassDemo,
  updatedAt: '2026-10-30'
}

export default helperCompassCase
