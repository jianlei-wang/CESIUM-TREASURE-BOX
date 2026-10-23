import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const LandslideRocksThreeDemo = defineAsyncComponent(() => import('./LandslideRocksThreeDemo.vue'))

const landslideRocksCase: DemoCard = {
  id: 'landslide-rocks-three',
  title: '山地滑坡、滚石与防护拦截',
  category: 'cesium-three',
  description: '在倾斜坡面上释放不同粒径的岩块，受重力沿坡加速、摩擦减速并冲击防护挡墙；实时统计最大速度、滚落距离和拦截率，支持干湿坡面与挡墙高度对比。',
  tag: 'Cesium + Three.js · 坡面接触',
  component: LandslideRocksThreeDemo,
  updatedAt: '2026-10-23'
}

export default landslideRocksCase
