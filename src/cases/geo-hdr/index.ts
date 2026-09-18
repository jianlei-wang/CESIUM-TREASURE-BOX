import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const GeoHdrDemo = defineAsyncComponent(() => import('./GeoHdrDemo.vue'))

const geoHdrCase: DemoCard = {
  id: 'geo-hdr',
  title: '动态曝光与色调映射',
  category: 'geo',
  description:
    '物理天空散射输出半浮点 HDR 线性值，经 ACES 色调映射与抖动降阶消 banding；昼/夜曝光与晨昏过渡角按相机当地太阳高度动态插值，实时 HUD 显示太阳高度与有效曝光倍数',
  tag: 'HDR 色调',
  icon: iconUrl,
  component: GeoHdrDemo,
  updatedAt: '2026-09-04'
}

export default geoHdrCase
