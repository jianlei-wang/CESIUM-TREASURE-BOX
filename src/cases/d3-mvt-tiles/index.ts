import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-mvt-tiles'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-mvt-tiles',
  title: 'D3大数据-MVT矢量瓦片直载',
  category: 'd3',
  description: '按瓦片层级分块生成矢量要素并逐要素着色，点击拾取要素属性。',
  tag: 'MVT, 矢量瓦片',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
