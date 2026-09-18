import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightSsaoDemo = defineAsyncComponent(() => import('./LightSsaoDemo.vue'))

const lightSsaoCase: DemoCard = {
  id: 'light-ssao',
  title: '光照效果-SSAO 环境光遮蔽',
  category: 'lighting',
  description:
    '基于屏幕空间的环境光遮蔽后处理，为建筑缝隙、墙角与接触面补充接触阴影：遮蔽强度、采样距离上限、深度偏差、光线步长、模糊步长与单像素上限实时可调，支持仅显示 AO 便于观察遮蔽结果',
  tag: '光照效果',
  icon,
  component: LightSsaoDemo,
  updatedAt: '2026-09-12'
}

export default lightSsaoCase
