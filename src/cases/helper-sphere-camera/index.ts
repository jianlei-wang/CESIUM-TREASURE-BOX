import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const HelperSphereCameraDemo = defineAsyncComponent(() => import('./HelperSphereCameraDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-sphere-camera',
  title: '球面环绕相机',
  category: 'scene',
  description: '拖动地图围绕一点旋转相机，位置不变只改变朝向',
  tag: '场景工具',
  component: HelperSphereCameraDemo,
  updatedAt: '2026-10-30'
}

export default caseItem
