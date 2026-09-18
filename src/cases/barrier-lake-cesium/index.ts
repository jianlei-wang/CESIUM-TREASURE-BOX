import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const BarrierLakeCesiumDemo = defineAsyncComponent(() => import('./BarrierLakeCesiumDemo.vue'))

const barrierLakeCesiumCase: DemoCard = {
  id: 'barrier-lake-cesium',
  title: '堰塞湖形成与溃决演示',
  category: 'analysis',
  icon,
  description:
    '在 Cesium 三维地球上复刻堰塞湖演化演示：以岷江上游深切河谷为锚点，用自定义 Primitive 网格构建可实时形变的 V 形谷、松散堰塞坝与溃口，配合水面着色器、滑坡碎屑、降雨粒子与随阶段切换的三维标注，完整呈现从深切河谷到成坝、蓄水、溃决或稳定留存的八个阶段',
  tag: 'Cesium, 堰塞湖, 地貌演化',
  component: BarrierLakeCesiumDemo,
  updatedAt: '2026-09-14'
}

export default barrierLakeCesiumCase
