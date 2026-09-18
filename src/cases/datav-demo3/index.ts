import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const Datav3Demo = defineAsyncComponent(() => import('../../datav/demo3/Datav3Screen.vue'))

const caseItem: DemoCard = {
  id: 'datav-demo3',
  title: '风机模型展台',
  category: 'datav',
  description: 'GLB 风机展台：HDR 环境 / Bloom / 无限网格 / 叶片旋转 / 拆解还原，支持自动环绕',
  tag: '可视化大屏',
  icon,
  component: Datav3Demo,
  updatedAt: '2026-09-08',
}

export default caseItem
