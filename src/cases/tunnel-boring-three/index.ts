import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const TunnelBoringThreeDemo = defineAsyncComponent(() => import('./TunnelBoringThreeDemo.vue'))

const tunnelBoringCase: DemoCard = {
  id: 'tunnel-boring-three',
  title: '盾构隧道掘进与管片支护',
  category: 'cesium-three',
  icon,
  description: '盾构机沿隧道轴线推进，刀盘按设定转速旋转，已开挖区段逐步安装管片环；随埋深增加掌子面水压上升，可调直径、推进速度、管片间距与总推力观察支护节奏。',
  tag: 'Cesium + Three.js · 隧道工程',
  component: TunnelBoringThreeDemo,
  updatedAt: '2026-10-23'
}

export default tunnelBoringCase
