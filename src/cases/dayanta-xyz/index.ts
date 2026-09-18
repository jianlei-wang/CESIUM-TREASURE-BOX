import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const DayantaXyzDemo = defineAsyncComponent(() => import('./DayantaXyzDemo.vue'))

const dayantaXyzCase: DemoCard = {
  id: 'dayanta-xyz',
  title: '大雁塔模型XYZ编辑坐标轴-平移/旋转',
  category: 'analysis',
  description: '将内置西安大雁塔 3D Tiles 模型与红黄绿XYZ编辑坐标轴绑定：拖动直线轴/端手柄沿轴平移模型中心点，拖动环形轴绕环所在轴方向旋转模型，平移与旋转互不干扰，实时同步中心坐标与姿态角、控制台打印操作信息，轴长/环半径/颜色等参数可调',
  tag: '坐标轴',
  icon,
  component: DayantaXyzDemo,
  updatedAt: '2026-09-02'
}

export default dayantaXyzCase
