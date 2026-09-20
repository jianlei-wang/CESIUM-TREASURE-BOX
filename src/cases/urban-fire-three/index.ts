import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const UrbanFireThreeDemo = defineAsyncComponent(() => import('./UrbanFireThreeDemo.vue'))

const urbanFireThreeCase: DemoCard = {
  id: 'urban-fire-three',
  title: 'Three.Quarks 城市火灾蔓延',
  category: 'particles',
  description:
    '参考“城市火灾蔓延”方案：街区建筑网格中每个着火单元挂一组火焰与烟羽发射器，轻量状态机按“未燃→燃烧→熄灭”推进，并按风向对下风侧邻栋提高引燃概率。建筑体色随状态在正常、燃烧、焦黑间切换，火势受风驱动弯曲。网格规模、火焰/烟雾量、蔓延概率与间隔、燃烧时长、风向风速、烟雾浓度与亮度均可调整',
  tag: 'Three.js, three.quarks, 粒子特效, 应急',
  component: UrbanFireThreeDemo,
  updatedAt: '2026-09-20'
}

export default urbanFireThreeCase
