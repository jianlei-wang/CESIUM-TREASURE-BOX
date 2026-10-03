import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const PlumeVolumeDemo = defineAsyncComponent(() => import('./PlumeVolumeDemo.vue'))

const plumeVolumeCase: DemoCard = {
  id: 'volume-plume',
  title: '空间分析-地下水污染羽流三维体',
  category: 'data',
  description:
    '工业遗留场地地下水污染调查工作台：以平流—弥散—衰变模型生成三维污染羽流，叠加潜水含水层、粉质黏土隔水层与多层承压含水层，支持 TCE / 六价铬 / TDS 多污染物切换、风险浓度等值面、监测井孔垂向浓度曲线、源区与地下水流向标注，以及污染体积 / 影响面积 / 前缘距离 / 峰值浓度统计、时间演变与任意方向剖切，配套 6 组相机预设与体素拾取。',
  tag: '水文体渲染',
  updatedAt: '2026-10-03',
  component: PlumeVolumeDemo
}

export default plumeVolumeCase
