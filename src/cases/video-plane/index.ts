import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const VideoPlaneDemo = defineAsyncComponent(() => import('./VideoPlaneDemo.vue'))

const VideoPlaneCase: DemoCard = {
  id: 'video-plane',
  title: '数据可视化-平面视频',
  category: 'data',
  icon,
  description: '将视频作为纹理贴地显示为平面影像，支持宽度、高度、透明度调节，可点击地图定位视频区域',
  tag: '平面视频',
  component: VideoPlaneDemo,
  updatedAt: '2026-09-01'
}

export default VideoPlaneCase
