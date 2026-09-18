import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const GltfViewerDemo = defineAsyncComponent(() => import('./GltfViewerDemo.vue'))

const gltfViewerCase: DemoCard = {
  id: 'gltf-viewer',
  title: 'glTF/GLB 模型查看器',
  category: 'tiles',
  description: '加载远程或本地 glTF/GLB 模型，支持位置、旋转、缩放、外观与相机控制',
  tag: '模型加载',
  icon,
  component: GltfViewerDemo,
  updatedAt: '2026-09-06'
}

export default gltfViewerCase
