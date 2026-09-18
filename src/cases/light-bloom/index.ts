import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightBloomDemo = defineAsyncComponent(() => import('./LightBloomDemo.vue'))

const lightBloomCase: DemoCard = {
  id: 'light-bloom',
  title: '光照效果-Bloom 泛光',
  category: 'lighting',
  description:
    '基于 Cesium 内置 bloom 后处理阶段的高亮泛光：阈值对比度、亮度偏移、模糊核间距、高斯 sigma、步长与仅显示泛光等参数实时可调，配合 HDR 管线让城市灯光与高亮区域产生柔和光晕',
  tag: '光照效果',
  icon,
  component: LightBloomDemo,
  updatedAt: '2026-09-12'
}

export default lightBloomCase
