import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const VideoProjectionDemo = defineAsyncComponent(() => import('./VideoProjectionDemo.vue'))

const VideoProjectionCase: DemoCard = {
  id: 'video-projection',
  title: '数据可视化-实时视频投影融合',
  category: 'data',
  description:
    '依据摄像头内外参数实时求解视锥体与地形裁切面，以全屏后处理将视频纹理投影到真实地形表面，支持单路视频投影与多路视频融合叠加，视锥体线框、裁切边界、边缘羽化与深度羽化参数实时可调',
  tag: '视频投影',
  component: VideoProjectionDemo,
  icon: iconUrl,
  updatedAt: '2026-09-12'
}

export default VideoProjectionCase
