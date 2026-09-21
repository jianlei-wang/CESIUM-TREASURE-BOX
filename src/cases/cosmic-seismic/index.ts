import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CosmicSeismicDemo = defineAsyncComponent(() => import('./CosmicSeismicDemo.vue'))

const cosmicSeismicCase: DemoCard = {
  id: 'cosmic-seismic',
  title: 'VFX 地震波传播环',
  category: 'particles',
  icon,
  description:
    '以贴地同心环带还原地震波传播：蓝白 P 波最快、橙黄 S 波次之、红色面波最慢且振幅最大并多次尾波回绕，环带振幅随球面几何扩散与介质衰减变化；震中持续发光，周围建筑按波到时间产生水平摆动，近震中与软土场地响应更大。震级、P/S/面波速度、环带宽度、衰减长度、亮度、建筑数量与摆动幅度、三类波的着色均可实时调整',
  tag: 'Three.js, 科学可视化, 地震学',
  component: CosmicSeismicDemo,
  updatedAt: '2026-09-21'
}

export default cosmicSeismicCase
