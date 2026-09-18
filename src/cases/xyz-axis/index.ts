import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const XyzAxisDemo = defineAsyncComponent(() => import('./XyzAxisDemo.vue'))

const xyzAxisCase: DemoCard = {
  id: 'xyz-axis',
  title: '自定义XYZ坐标轴-拖拽平移',
  category: 'analysis',
  description: '在指定中心点创建红黄绿XYZ坐标轴，悬停高亮为黄色、按下加粗，拖动沿轴方向平移并实时同步坐标、控制台打印平移信息',
  tag: '坐标轴',
  icon,
  component: XyzAxisDemo,
  updatedAt: '2026-09-02'
}

export default xyzAxisCase
