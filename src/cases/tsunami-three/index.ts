import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const TsunamiThreeDemo = defineAsyncComponent(() => import('./TsunamiThreeDemo.vue'))

const tsunamiThreeCase: DemoCard = {
  id: 'tsunami-three',
  title: 'VFX 海啸推进',
  category: 'particles',
  icon,
  description:
    '以三维高度场浪面还原海啸推进：水面在锋面处陡直抬升、向后方缓慢回落形成有体积感的浪墙，浪面叠加逐像素法线光照、菲涅尔反射与高频碎浪扰动，前缘由泡沫、飞沫与浑浊泥沙共同构成白水线。浪头沿推进方向逐栋淹没沿岸建筑并使其颜色转暗。浪面宽度、推进距离、浪高、浪背长度、碎浪扰动、波速、泡沫/飞沫/泥沙量与建筑数量/高度、水体与泥沙颜色、不透明度均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 灾害',
  component: TsunamiThreeDemo,
  updatedAt: '2026-09-20'
}

export default tsunamiThreeCase
