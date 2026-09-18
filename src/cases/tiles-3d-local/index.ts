import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Tiles3DLocalDemo = defineAsyncComponent(() => import('./Tiles3DLocalDemo.vue'))

const tiles3DLocalCase: DemoCard = {
  id: 'tiles-3d-local',
  title: '本地 3DTiles 查看器',
  category: 'tiles',
  description: '加载本地（拖拽/选择文件夹）或远程 3DTiles，支持屏幕空间误差、包围盒、线框与裁剪平面等参数调整',
  tag: '模型加载',
  icon,
  component: Tiles3DLocalDemo,
  updatedAt: '2026-09-09'
}

export default tiles3DLocalCase
