import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const EarthworkAnalysisDemo = defineAsyncComponent(() => import('./EarthworkAnalysisDemo.vue'))

const earthworkAnalysisCase: DemoCard = {
  id: 'earthwork-analysis',
  title: '空间分析-土方量分析',
  category: 'analysis',
  description:
    '在地图上贴地绘制多边形或矩形分析区域，按网格法对原始地形与设计面高差逐单元积分，输出挖方量、填方量、净方量与填挖热力图；设计面支持水平面、斜面（坡度与坡向）与地形偏移面三种模式，可调网格分辨率、设计高程、显示透明度等参数，支持 PDF/Word 分析报告输出，内置功能实现说明',
  tag: '空间分析',
  icon,
  component: EarthworkAnalysisDemo
}

export default earthworkAnalysisCase
