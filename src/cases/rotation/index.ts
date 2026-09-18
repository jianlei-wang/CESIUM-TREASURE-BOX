import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const RotationDemo = defineAsyncComponent(() => import('./RotationDemo.vue'))
const rotationCase: DemoCard = {
  id: 'rotation',
  title: '常用工具-初始化自转',
  category: 'scene',
  description: '地图加载后相机自动旋转浏览，支持自转开关、角速度与 X/Y/Z 旋转轴实时调节',
  tag: '自转',
  icon,
  component: RotationDemo,
  updatedAt: '2026-08-27'
}

export default rotationCase
