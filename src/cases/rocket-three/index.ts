import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const RocketThreeDemo = defineAsyncComponent(() => import('./RocketThreeDemo.vue'))

const rocketThreeCase: DemoCard = {
  id: 'rocket-three',
  title: 'VFX 火箭发射',
  category: 'particles',
  icon,
  description:
    '以可循环的时序编排还原火箭发射：点火阶段尾焰由弱到强、导流槽高压水雾向上翻涌，离架后箭体沿加速曲线爬升，跨音速窗口在箭体尾部闪烁马赫盘钻石激波，达到分离高度后助推器抛离并触发分离闪光，随后回落复位进入下一轮。推力、尾焰尺寸/颜色、导流水雾量/张角、火星量、爬升加速度、最大高度、循环周期与风速均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 航天',
  component: RocketThreeDemo,
  updatedAt: '2026-09-20'
}

export default rocketThreeCase
