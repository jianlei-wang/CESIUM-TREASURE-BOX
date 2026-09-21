import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CollapseThreeDemo = defineAsyncComponent(() => import('./CollapseThreeDemo.vue'))

const collapseThreeCase: DemoCard = {
  id: 'collapse-three',
  title: 'VFX 建筑碎裂坍塌',
  category: 'particles',
  icon,
  description:
    '建筑自底部失稳后整体倾斜下沉，触地瞬间由完整楼体切换为碎块群：碎块按抛物线飞散、翻滚并落地堆存，地面冲击尘环向外扩张，尘云持续抬升扩散并随风漂移。楼层数、碎块数、坍塌时长与保持时长、起爆力、尘环半径/速度、尘云量/尺寸/寿命/风向风速与尘云颜色、不透明度均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 灾害',
  component: CollapseThreeDemo,
  updatedAt: '2026-09-20'
}

export default collapseThreeCase
