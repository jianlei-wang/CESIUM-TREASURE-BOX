import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const StudyAreaDemo = defineAsyncComponent(() => import('./StudyAreaDemo.vue'))

const studyAreaCase: DemoCard = {
  id: 'geo-study-area',
  title: '空间分析-研究区裁剪与要素筛选',
  category: 'analysis',
  description:
    '在地图上定义多边形研究区，实时裁剪兴趣点图层并统计区内数量、最近边界距离与要素密度，支持多边形绘制、半径缓冲区、类别过滤与裁剪开关，用于快速聚焦局部分析范围。',
  tag: '研究区, 裁剪, 缓冲区, 要素统计',
  component: StudyAreaDemo,
  updatedAt: '2026-11-12'
}

export default studyAreaCase
