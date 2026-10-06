import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-storytelling'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-storytelling',
  title: 'D3大数据-数据故事滚动叙事',
  category: 'd3',
  description: '章节导航驱动镜头飞行与图层显隐，用镜头语言讲述数据空间故事。',
  tag: '叙事, 镜头编排',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
