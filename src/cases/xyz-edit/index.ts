import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const XyzEditDemo = defineAsyncComponent(() => import('./XyzEditDemo.vue'))

const xyzEditCase: DemoCard = {
  id: 'xyz-edit',
  title: '自定义XYZ编辑坐标轴-平移/旋转',
  category: 'analysis',
  description: '在指定中心点创建红黄绿XYZ编辑坐标轴（三直线轴+三环形轴融合）：拖动直线轴/端手柄沿轴方向平移中心点，拖动环形轴绕环所在轴方向旋转，悬停高亮为黄色、按下加粗，实时同步坐标与姿态、控制台打印操作信息',
  tag: '坐标轴',
  icon,
  component: XyzEditDemo,
  updatedAt: '2026-09-02'
}

export default xyzEditCase
