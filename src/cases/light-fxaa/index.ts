import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightFxaaDemo = defineAsyncComponent(() => import('./LightFxaaDemo.vue'))

const lightFxaaCase: DemoCard = {
  id: 'light-fxaa',
  title: '光照效果-抗锯齿',
  category: 'lighting',
  description:
    '后处理抗锯齿 FXAA 开关与渲染分辨率缩放实时可调，通过细线与建筑边缘对比锯齿改善效果；桌面端推荐启用 MSAA 4x，移动端关闭 MSAA 并启用 FXAA 以兼顾画质与帧率',
  tag: '光照效果',
  icon,
  component: LightFxaaDemo,
  updatedAt: '2026-09-12'
}

export default lightFxaaCase
