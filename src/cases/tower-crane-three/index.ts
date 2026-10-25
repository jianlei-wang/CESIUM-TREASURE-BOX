import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const TowerCraneThreeDemo = defineAsyncComponent(() => import('./TowerCraneThreeDemo.vue'))

const towerCraneCase: DemoCard = {
  id: 'tower-crane-three',
  title: '塔吊吊装、钢缆摆动与载荷控制',
  category: 'cesium-three',
  icon,
  description: '塔吊按设定速度回转，小车沿吊臂变幅，吊钩随索长起升下降；吊物受回转离心力、风载和自身重力形成摆动。可调吊物质量、索长、回转速度、起升速度与阻尼，并显示工作半径和张力估算。',
  tag: 'Cesium + Three.js · 关节与摆动',
  component: TowerCraneThreeDemo,
  updatedAt: '2026-10-23'
}

export default towerCraneCase
