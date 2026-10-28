import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const VegetationPlacementThreeDemo = defineAsyncComponent(() => import('./VegetationPlacementThreeDemo.vue'))

const vegetationPlacementThreeCase: DemoCard = {
  id: 'vegetation-placement-three',
  title: '场景植被批量布设与绘制来源',
  category: 'cesium-three',
  description: '植被按区域面积与每公顷密度撒点，树木、草本、花朵与岩石分别独立开关与缩放；布设来源可切换为含孔洞的林地多边形、手绘矩形与圆形、沿路散点或等间距网格点位，生成后可随风摆动并按最大视距裁剪。',
  tag: 'Cesium + Three.js · 植被布设',
  component: VegetationPlacementThreeDemo,
  updatedAt: '2026-10-27'
}

export default vegetationPlacementThreeCase
