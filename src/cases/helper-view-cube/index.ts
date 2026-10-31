import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const HelperViewCubeDemo = defineAsyncComponent(() => import('./HelperViewCubeDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-view-cube',
  title: '视角立方体',
  category: 'widgets',
  description: '视角立方体与方位三轴，点击面或轴快速切换相机视角',
  tag: '界面控件',
  component: HelperViewCubeDemo,
  updatedAt: '2026-10-30'
}

export default caseItem
