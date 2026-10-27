import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CimTilesClassifyDemo = defineAsyncComponent(() => import('./CimTilesClassifyDemo.vue'))

const cimTilesClassifyCase: DemoCard = {
  id: 'cim-tiles-classify',
  title: '倾斜模型分区分类高亮',
  category: 'tiles',
  description: '在倾斜摄影模型上叠加分类体，按象限拾取并实时高亮指定片区',
  tag: '3D Tiles',
  icon,
  component: CimTilesClassifyDemo,
  updatedAt: '2026-10-25'
}

export default cimTilesClassifyCase
