import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LandslideCesiumDemo = defineAsyncComponent(() => import('./LandslideCesiumDemo.vue'))

const landslideCesiumCase: DemoCard = {
  id: 'landslide-cesium',
  title: '滑坡形成与运动演示',
  category: 'analysis',
  icon,
  description:
    '把滑坡发育过程移植到 Cesium 真实地形场景：基于解析式斜坡的高程网格、滑体沿弧形滑动面整体位移并在高速段解体、坡脚村庄掩埋与截排水沟/抗滑桩/抗滑挡墙等防治工程，配合 Bing 影像、阶段标注、降雨粒子与多机位预设，讲解滑坡从蠕动变形到减速堆积的四阶段',
  tag: 'Cesium, 滑坡, 地质灾害, 三维场景',
  component: LandslideCesiumDemo,
  updatedAt: '2026-09-14'
}

export default landslideCesiumCase
