import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const SlopeGnssWarningDemo = defineAsyncComponent(() => import('./SlopeGnssWarningDemo.vue'))

const slopeGnssWarningCase: DemoCard = {
  id: 'slope-gnss-warning',
  title: '边坡 GNSS 位移预警与三级影响区',
  category: 'analysis',
  description:
    '仿真 GNSS 监测网时序，按速率 / 改进切线角 / 累计位移 / 降雨耦合判据分级预警，经 IDW 变形场与能量线滑距推演生成核心区、重点区、影响区，支持阈值率定、时间轴回放与报告导出',
  tag: '地灾预警',
  icon,
  component: SlopeGnssWarningDemo,
  updatedAt: '2026-09-16'
}

export default slopeGnssWarningCase
