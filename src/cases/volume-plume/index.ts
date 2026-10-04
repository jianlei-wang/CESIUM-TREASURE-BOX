import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const PlumeVolumeDemo = defineAsyncComponent(() => import('./PlumeVolumeDemo.vue'))

const plumeVolumeCase: DemoCard = {
  id: 'volume-plume',
  title: '空间分析-地下水污染羽流三维体',
  category: 'data',
  description:
    '工业遗留场地地下水污染调查工作台：以多层含水层平流—弥散—衰减模型生成三维污染羽流，潜水/承压含水层与弱透水层分层赋存，叠加地下水流线、抽采井捕获区与监测井网；支持 TCE / 六价铬 / TDS 多污染物切换、风险边界 + 污染核心双层等值面、带筛管区间的分层井孔浓度曲线，以及污染体积 / 核心体积 / 影响面积 / 前缘距离 / 抽采捕获率统计、按月时间演变、可调体素分辨率与 6 组调查相机预设，并支持体素拾取。',
  tag: '水文体渲染',
  updatedAt: '2026-10-04',
  component: PlumeVolumeDemo
}

export default plumeVolumeCase
