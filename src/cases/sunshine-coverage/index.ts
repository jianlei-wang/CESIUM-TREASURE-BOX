import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const SunshineCoverageDemo = defineAsyncComponent(() => import('./SunshineCoverageDemo.vue'))

const sunshineCoverageCase: DemoCard = {
  id: 'sunshine-coverage',
  title: '空间分析-日照覆盖分析',
  category: 'analysis',
  description:
    '按规划街区参数化白模对地面网格逐点进行光线投射遮蔽检测，累计有效日照时数并生成日照色斑与等值线；支持设定采样分析高度区间，输出指定高度结果图、区间内空间网格或区间内空间点集结果，分析结果展示与地图渲染对齐阴影分析案例；支持标准日、气候区、时间带、时间步长、网格间距、采样高度等参数调整，支持 PDF/Word 分析报告输出，内置功能实现说明',
  tag: '空间分析',
  icon,
  component: SunshineCoverageDemo
}

export default sunshineCoverageCase
