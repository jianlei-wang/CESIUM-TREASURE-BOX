import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CosmicPointCloudDemo = defineAsyncComponent(() => import('./CosmicPointCloudDemo.vue'))

const cosmicPointCloudCase: DemoCard = {
  id: 'cosmic-pointcloud',
  title: 'VFX 点云地球转场',
  category: 'particles',
  icon,
  description:
    '同一批点在三种语义状态间连续形变：从城市楼宇立面点云浮升汇聚成地球态（噪声陆海掩膜使大陆清晰可辨、海洋点下沉留空），再解体为对数螺旋臂的星云态，循环往复。着色器按逐点随机延迟做缓动插值，过渡中段向外球面外推并放大尺寸，形成解体—重组感。点数、地球半径、城市范围/高度、螺旋臂数与张角、星云半径、点尺寸、循环周期、亮度与配色均可调整',
  tag: 'Three.js, GPU 点云, 形变转场',
  component: CosmicPointCloudDemo,
  updatedAt: '2026-09-21'
}

export default cosmicPointCloudCase
