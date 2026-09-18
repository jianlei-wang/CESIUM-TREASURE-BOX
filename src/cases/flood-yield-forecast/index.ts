import type { DemoCard } from '../types'
import FloodYieldForecastDemo from './FloodYieldForecastDemo.vue'
import iconUrl from './icon.webp'

const card: DemoCard = {
  id: 'flood-yield-forecast',
  title: 'DEM+气象预报 产水与淹没预测',
  category: 'analysis',
  description: '从真实或模拟 DEM 出发，依次完成填洼、真实洼地识别、D8 流向、降水与下垫面产流（SCS-CN / 径流系数）、汇流演算，并以等体积平面或洼地蓄水+溢流方案模拟淹没，输出分级统计与情景对比。',
  tag: 'DEM, 产流, 淹没',
  icon: iconUrl,
  component: FloodYieldForecastDemo,
  updatedAt: '2026-09-09'
}

export default card
