import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const SnowThreeDemo = defineAsyncComponent(() => import('./SnowThreeDemo.vue'))

const snowThreeCase: DemoCard = {
  id: 'snow-three',
  title: 'VFX 雪 / 风吹雪 / 积雪',
  category: 'particles',
  icon,
  description:
    '分层还原真实降雪：细雪为柔和小点，片状雪花使用程序化六重枝晶纹理并带随机初始姿态与三维翻滚，近景再叠加放大虚化散景以制造景深视差。飘落阶段受统一风向与周期性阵风拖曳，贴地吹雪用拉伸拖尾沿风向外扫；地表为噪声起伏的积雪堆，随累积参数由中心向外铺展、抬升并逐渐亮起，表面散布闪烁雪晶。细雪/片状/散景数量、雪花尺寸、下落速度、范围高度、风向风速、阵风、摆动、吹雪量/速度、积雪厚度、自旋与整体不透明度均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 气象',
  component: SnowThreeDemo,
  updatedAt: '2026-09-20'
}

export default snowThreeCase
