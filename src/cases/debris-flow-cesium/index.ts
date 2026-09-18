import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const DebrisFlowCesiumDemo = defineAsyncComponent(() => import('./DebrisFlowCesiumDemo.vue'))

const debrisFlowCesiumCase: DemoCard = {
  id: 'debris-flow-cesium',
  title: '泥石流形成与运动演示',
  category: 'analysis',
  icon,
  description:
    '把泥石流过程移植到 Cesium 真实地形场景：基于解析式沟谷的高程网格、龙头裹挟泥浆漂砾沿沟道阵性下泄、沟口堆积扇扩展并淤埋村庄，配合物源松散体、流体由清转浑的着色变化、拦挡坝/排导槽/停淤场等防治工程，以及 Bing 影像、阶段标注与多机位预设，讲解泥石流从暴雨汇流到出沟堆积的四阶段',
  tag: 'Cesium, 泥石流, 地质灾害, 三维场景',
  component: DebrisFlowCesiumDemo,
  updatedAt: '2026-09-14'
}

export default debrisFlowCesiumCase
