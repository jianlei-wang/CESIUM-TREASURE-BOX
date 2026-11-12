import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const DetectionOverlayDemo = defineAsyncComponent(() => import('./DetectionOverlayDemo.vue'))

const detectionOverlayCase: DemoCard = {
  id: 'geo-detection-overlay',
  title: '数据可视化-目标检测框叠层',
  category: 'data',
  description:
    '把目标检测结果以屏幕空间包围框叠加在地图场景上，包含类别着色、置信度标签、跟踪编号与目标方向箭头，支持置信度阈值过滤、框体样式与标签显隐调节，目标随场景旋转实时跟随。',
  tag: '目标检测, 叠层, 包围框, 跟踪',
  component: DetectionOverlayDemo,
  updatedAt: '2026-11-12'
}

export default detectionOverlayCase
