import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const VolcanoThreeDemo = defineAsyncComponent(() => import('./VolcanoThreeDemo.vue'))

const volcanoThreeCase: DemoCard = {
  id: 'volcano-three',
  title: 'VFX 火山喷发',
  category: 'particles',
  icon,
  description:
    '程序化生成带放射状冲沟与锥体噪声的火山地形，顶部为碗状火山口与脉动熔岩湖，数条熔岩流沿冲沟自火山口向下延伸。喷口位于真实火山口内，分层叠加高速熔岩喷泉、受风切变弯曲的灰烬柱、顶部扩散的伞状灰羽、抛物线飞溅的暗色岩块与高空沉降落灰；随时间累积的灰烬毯逐渐覆盖锥体并向外铺展形成灰烬掩埋。熔岩量/速度/尺寸、灰烬量/寿命/体积、风切变、岩块量/重力、熔岩辉光与灰烬掩埋程度均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 地质',
  component: VolcanoThreeDemo,
  updatedAt: '2026-09-20'
}

export default volcanoThreeCase
