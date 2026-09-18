import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const DebrisFlowThreeDemo = defineAsyncComponent(() => import('./DebrisFlowThreeDemo.vue'))

const debrisFlowThreeCase: DemoCard = {
  id: 'debris-flow-three',
  title: '泥石流形成与运动 3D 演示',
  category: 'three',
  icon,
  description:
    '纯 Three.js 构建的泥石流过程演示：解析式沟谷地形与形成区—流通区—堆积区分区，龙头裹挟泥浆漂砾沿沟道阵性下泄，沟口堆积扇扩展并淤埋村庄，配合物源松散体、清水转泥浆的流态变化、拦挡坝与排导槽等防治工程，完整讲解泥石流从暴雨汇流到出沟堆积的四个阶段',
  tag: 'Three.js, 泥石流, 地质灾害',
  component: DebrisFlowThreeDemo,
  updatedAt: '2026-09-15'
}

export default debrisFlowThreeCase
