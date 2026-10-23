import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const WindClothThreeDemo = defineAsyncComponent(() => import('./WindClothThreeDemo.vue'))

const windClothCase: DemoCard = {
  id: 'wind-cloth-three',
  title: '城市风场、旗帜布料与植被摇摆',
  category: 'cesium-three',
  description: '风向风速连续变化，旗帜布料按顶点正弦约束产生行波，树冠随阵风摆动，地面漂浮物沿风向输运；可调风速、风向、阵风强度、布料刚度与植被响应幅度。',
  tag: 'Cesium + Three.js · 风场与布料',
  component: WindClothThreeDemo,
  updatedAt: '2026-10-23'
}

export default windClothCase
