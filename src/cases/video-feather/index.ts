import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const VideoFeatherDemo = defineAsyncComponent(() => import('./VideoFeatherDemo.vue'))

const VideoFeatherCase: DemoCard = {
  id: 'video-feather',
  title: '数据可视化-视频融合(羽化)',
  category: 'data',
  icon,
  description: '视频叠加到地形后边缘以羽化渐变方式渐隐融合，支持羽化宽度、透明度、位置、尺寸实时调节，过渡自然柔和',
  tag: '视频羽化',
  component: VideoFeatherDemo,
  updatedAt: '2026-09-01'
}

export default VideoFeatherCase
