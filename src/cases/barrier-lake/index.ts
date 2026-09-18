import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const BarrierLakeDemo = defineAsyncComponent(() => import('./BarrierLakeDemo.vue'))

const barrierLakeCase: DemoCard = {
  id: 'barrier-lake',
  title: '堰塞湖形成与溃决 3D 演示',
  category: 'three',
  icon,
  description:
    '纯 Three.js 构建的堰塞湖地貌演化演示：解析式河床纵剖面与 V 形谷、滑坡堆积成坝、蓄水回水、漫顶溃决洪峰等连续八阶段状态机插值，配合水面着色器、地形顶点色、松散岩块与实时标注，完整讲解堰塞湖从孕育到溃决（或稳定留存）的全过程',
  tag: 'Three.js, 堰塞湖, 地貌演化',
  component: BarrierLakeDemo,
  updatedAt: '2026-09-15'
}

export default barrierLakeCase
