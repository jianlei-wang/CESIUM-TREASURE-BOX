import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const SatelliteOrbitDemo = defineAsyncComponent(() => import('./SatelliteOrbitDemo.vue'))
import icon from './icon.webp'

const satelliteOrbitCase: DemoCard = {
  id: 'geo-satellite-orbit',
  title: '空间分析-卫星轨道与星下点推演',
  category: 'analysis',
  description:
    '由半长轴、偏心率、倾角、升交点赤经与近地点幅角推演卫星开普勒轨道，实时绘制轨道环、星下点轨迹与卫星位置，支持轨道参数调节、时间倍速推进与地面覆盖圆显示。',
  tag: '轨道, 星下点, 卫星, 开普勒',
  icon,
  component: SatelliteOrbitDemo,
  updatedAt: '2026-11-12'
}

export default satelliteOrbitCase
