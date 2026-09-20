import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const MeteorThreeDemo = defineAsyncComponent(() => import('./MeteorThreeDemo.vue'))

const meteorThreeCase: DemoCard = {
  id: 'meteor-three',
  title: 'Three.Quarks 流星雨 / 再入火球',
  category: 'particles',
  description:
    '参考“流星雨 / 再入火球”方案：沿预计算的下行弹道驱动移动发射器，粒子在静止世界坐标中遗留下拉长的发光尾迹，头部明亮、尾部淡青，并伴随反向后抛的烧蚀火花。并发流星数、间隔、再入速度、寿命、尺寸、尾迹长度、散布与重力均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 天文',
  component: MeteorThreeDemo,
  updatedAt: '2026-09-20'
}

export default meteorThreeCase
