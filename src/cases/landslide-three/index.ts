import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LandslideThreeDemo = defineAsyncComponent(() => import('./LandslideThreeDemo.vue'))

const landslideThreeCase: DemoCard = {
  id: 'landslide-three',
  title: '滑坡形成与运动 3D 演示',
  category: 'three',
  icon,
  description:
    '纯 Three.js 构建的滑坡发育过程演示：解析式斜坡地形与弧形滑动面、滑体沿滑面整体位移并在高速段解体为碎屑、坡脚村庄与道路受威胁、截排水沟与抗滑桩等防治工程实时生效，配合要素标注、降雨粒子与侧剖面视角，完整讲解滑坡从蠕动变形到减速堆积的四个阶段',
  tag: 'Three.js, 滑坡, 地质灾害',
  component: LandslideThreeDemo,
  updatedAt: '2026-09-15'
}

export default landslideThreeCase
