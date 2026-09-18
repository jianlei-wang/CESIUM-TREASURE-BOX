import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const ShadowAnalysisDemo = defineAsyncComponent(() => import('./ShadowAnalysisDemo.vue'))

const shadowAnalysisCase: DemoCard = {
  id: 'shadow-analysis',
  title: '空间分析-阴影分析',
  category: 'analysis',
  description: '启用级联阴影映射叠加地面阴影方向指示，按规划街区参数化白模实时渲染任意时刻太阳光照下的建筑阴影，阴影随时刻连续扫动；支持日期、时间轴播放与变速、阴影分辨率、最大计算距离、暗度、软阴影等参数，并支持设定采样分析高度区间，输出对应采样高度的结果图，或输出区间内的空间网格/空间点集阴影率分析结果（平均/最大阴影率、高阴影占比），支持 PDF/Word 分析报告输出，内置功能实现说明',
  tag: '空间分析',
  icon,
  component: ShadowAnalysisDemo
}

export default shadowAnalysisCase
