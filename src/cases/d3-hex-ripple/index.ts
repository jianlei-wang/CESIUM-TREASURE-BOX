import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-hex-ripple'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-hex-ripple',
  title: 'D3大数据-蜂窝波纹扫描',
  category: 'd3',
  description: '由中心向外传播的波纹逐格调制蜂窝柱高与颜色，形成雷达扫描式高亮特效。',
  tag: 'hexbin, 波纹特效',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
