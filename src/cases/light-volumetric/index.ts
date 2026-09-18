import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightVolumetricDemo = defineAsyncComponent(() => import('./LightVolumetricDemo.vue'))

const lightVolumetricCase: DemoCard = {
  id: 'light-volumetric',
  title: '光照效果-体积光',
  category: 'lighting',
  description:
    '自定义 PostProcessStage 实现径向模糊体积光（God Rays）：以光源屏幕位置为中心对亮度缓冲多次采样叠加，光线密度、衰减、采样权重与曝光实时可调，配合高亮光源标记呈现光束穿透大气效果',
  tag: '光照效果',
  icon,
  component: LightVolumetricDemo,
  updatedAt: '2026-09-12'
}

export default lightVolumetricCase
