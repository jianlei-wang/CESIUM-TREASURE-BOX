import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CosmicBlackholeDemo = defineAsyncComponent(() => import('./CosmicBlackholeDemo.vue'))

const cosmicBlackholeCase: DemoCard = {
  id: 'cosmic-blackhole',
  title: 'VFX 黑洞吸积盘与相对论喷流',
  category: 'particles',
  icon,
  description:
    '以真实地球为基底的宏大天体场景：巨大黑洞悬停在地球上空约 1.4 Re 处，真实地球作为前景/基底出现在画面下方；开普勒剪切粒子盘自动生成旋臂与缠绕结构，盘面按有效温度做黑体着色，approaching 侧多普勒增亮偏蓝、receding 侧偏暗偏红；中心为黑洞剪影、边缘细亮光子环，上方叠加被引力弯折的次级成像弧；两极相对论性喷流带螺旋磁场结构与周期性激波亮结。尺度以地球半径 Re 为基准（盘面约 1 Re、喷流约 1 Re），盘内外半径、自转速度、亮度、多普勒强度、喷流功率/长度/亮结数、整体倾角与冷热颜色均可调整',
  tag: 'Three.js, three.quarks, 天体物理, 相对论',
  component: CosmicBlackholeDemo,
  updatedAt: '2026-09-21'
}

export default cosmicBlackholeCase
