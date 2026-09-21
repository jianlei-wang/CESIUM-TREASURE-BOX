import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const NukeThreeDemo = defineAsyncComponent(() => import('./NukeThreeDemo.vue'))

const nukeThreeCase: DemoCard = {
  id: 'nuke-three',
  title: 'VFX 核爆蘑菇云',
  category: 'particles',
  icon,
  description:
    '以艺术标定的视觉仿真还原经典蘑菇云五阶段：火球半球膨胀并由白炽转橙红，随后被抬升的尘柱托起；帽部在目标高度由环状发射器配合绕竖直轴涡环力场与湍流完成翻卷，帽檐另有一层反向小涡制造向下翻卷层次；地面冲击波环与高空凝结云盘向外扩张，帽顶颗粒转入重力沉降形成随风长尾落尘。火球、尘柱、帽部、涡环转速、冲击波、落尘、风速与烟雾/辉光颜色均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 灾害',
  component: NukeThreeDemo,
  updatedAt: '2026-09-20'
}

export default nukeThreeCase
