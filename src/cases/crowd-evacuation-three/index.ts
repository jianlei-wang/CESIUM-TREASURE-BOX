import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const CrowdEvacuationThreeDemo = defineAsyncComponent(() => import('./CrowdEvacuationThreeDemo.vue'))

const crowdEvacuationCase: DemoCard = {
  id: 'crowd-evacuation-three',
  title: '城市人群疏散与出口流量',
  category: 'cesium-three',
  description: '人群从广场内向出口汇集，个体速度、恐慌扰动、出口宽度和内部障碍共同影响疏散过程；实时统计已疏散人数、出口流率、峰值密度和仿真时间，可观察出口变窄后的拥堵。',
  tag: 'Cesium + Three.js · 人群仿真',
  component: CrowdEvacuationThreeDemo,
  updatedAt: '2026-10-23'
}

export default crowdEvacuationCase
