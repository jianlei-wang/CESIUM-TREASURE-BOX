import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const GeoMoonDemo = defineAsyncComponent(() => import('./GeoMoonDemo.vue'))

const geoMoonCase: DemoCard = {
  id: 'geo-moon',
  title: '月球与月光照明',
  category: 'geo',
  icon: iconUrl,
  description:
    'Simon1994 月位经 ICRF→Fixed 求 ECEF 方向，月盘以 Oren-Nayar 月面反照率与冷蓝月光色调渲染，四周叠加月晕天空散射；月光强度与月晕亮度可调，月相（朔望）由日月光线夹角实时求解并 HUD 展示',
  tag: '月球',
  component: GeoMoonDemo,
  updatedAt: '2026-09-04'
}

export default geoMoonCase
