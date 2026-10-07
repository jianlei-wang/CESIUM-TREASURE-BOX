import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-contour-terrain'
import icon from './icon.webp'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-contour-terrain',
  title: 'D3大数据-等值线地形场三维抬升',
  category: 'd3',
  icon,
  description: '真实震级采样经 IDW 插值成场，d3.contours 提取等值面并拉伸为三维地形，演示地理分析与 Cesium 三维表达的结合。',
  tag: 'IDW, d3.contours, 三维地形',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
