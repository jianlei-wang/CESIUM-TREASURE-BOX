import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const SnowThreeDemo = defineAsyncComponent(() => import('./SnowThreeDemo.vue'))

const snowThreeCase: DemoCard = {
  id: 'snow-three',
  title: 'Three.Quarks 雪 / 风吹雪 / 积雪',
  category: 'particles',
  description:
    '参考“雪 + 风吹雪 + 积雪累积”方案：细雪、片状雪花、湿雪三类发射器以不同终端速度与摆动噪声制造视差，飘落阶段受统一风向拖曳；近地表另设吹雪层，密度随风速放大；地表叠加一张随累积参数渐显的径向积雪面。粒子数、雪花数、尺寸、下落速度、范围、高度、风向风速、摆动、吹雪量/速度、积雪厚度与整体不透明度、自旋速度均可调整',
  tag: 'Three.js, three.quarks, 粒子特效, 气象',
  component: SnowThreeDemo,
  updatedAt: '2026-09-20'
}

export default snowThreeCase
