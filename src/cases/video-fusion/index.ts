import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const VideoFusionDemo = defineAsyncComponent(() => import('./VideoFusionDemo.vue'))

const VideoFusionCase: DemoCard = {
  id: 'video-fusion',
  title: '数据可视化-视频融合',
  category: 'data',
  icon,
  description: '视频以半透明方式与地形融合显示，支持透明度、位置、尺寸实时调节，实现影像与地形的无缝叠加',
  tag: '视频融合',
  component: VideoFusionDemo,
  updatedAt: '2026-09-01'
}

export default VideoFusionCase
