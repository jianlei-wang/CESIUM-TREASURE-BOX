import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const CameraInfoDemo = defineAsyncComponent(() => import('./CameraInfoDemo.vue'))
import icon from './icon.webp'

const cameraInfoCase: DemoCard = {
  id: 'camera-info',
  title: '相机参数-位置与四至',
  category: 'scene',
  description: '实时展示相机位置、朝向与视口四至坐标，一键复制相机参数',
  tag: '场景工具',
  component: CameraInfoDemo,
  icon,
  updatedAt: '2026-08-23'
}

export default cameraInfoCase
