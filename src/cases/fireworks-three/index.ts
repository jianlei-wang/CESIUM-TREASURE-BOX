import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const FireworksThreeDemo = defineAsyncComponent(() => import('./FireworksThreeDemo.vue'))

const fireworksThreeCase: DemoCard = {
  id: 'fireworks-three',
  title: 'Three.Quarks 烟花粒子',
  category: 'particles',
  icon,
  description:
    '基于 three.quarks 粒子引擎与 Cesium 地球的烟花特效：球壳发射器定时爆裂，多层辉光球壳与拉伸拖尾火星同步绽放，重力与随机位置让烟花在地球上空连续随机升起，可选缤纷、金色、赤红、湛蓝、紫罗兰五种配色。爆裂粒子数、速度、尺寸、寿命、重力、爆裂半径、发射间隔均可实时调整并即时生效，切换配色方案会重建粒子系统',
  tag: 'Three.js, three.quarks, 粒子特效',
  component: FireworksThreeDemo,
  updatedAt: '2026-09-19'
}

export default fireworksThreeCase
