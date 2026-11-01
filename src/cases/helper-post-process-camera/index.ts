import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const HelperPostProcessCameraDemo = defineAsyncComponent(() => import('./HelperPostProcessCameraDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-post-process-camera',
  title: '镜头-聚光移轴与动态模糊',
  category: 'effects',
  description: '聚光灯、移轴、运动模糊、速度线与广角镜头畸变、果冻效应六种镜头语言：点击地图可把焦点锁定到地表位置，配合模糊与暗角模拟航拍与运动镜头。',
  tag: '后期特效',
  icon,
  component: HelperPostProcessCameraDemo,
  updatedAt: '2026-11-01'
}

export default caseItem
