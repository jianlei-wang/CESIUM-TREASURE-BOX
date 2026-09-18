import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const XyzRotateDemo = defineAsyncComponent(() => import('./XyzRotateDemo.vue'))

const xyzRotateCase: DemoCard = {
  id: 'xyz-rotate',
  title: '自定义XYZ球形坐标轴-拖拽旋转',
  category: 'analysis',
  description: '在指定中心点创建红黄绿XYZ环形坐标轴（三正交环形轴成球形），悬停高亮为黄色、按下加粗，拖动环形轴使坐标系绕环所在轴方向旋转、姿态角实时同步，控制台打印旋转信息',
  tag: '坐标轴',
  icon,
  component: XyzRotateDemo,
  updatedAt: '2026-09-02'
}

export default xyzRotateCase
