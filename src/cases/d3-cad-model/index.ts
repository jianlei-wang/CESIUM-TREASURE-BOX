import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-cad-model'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-cad-model',
  title: 'D3大数据-CAD模型线面渲染',
  category: 'd3',
  description: '程序化建筑体块面/线框/顶点分离显隐，d3 汇总输出建筑属性表。',
  tag: 'CAD, 线面体',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
