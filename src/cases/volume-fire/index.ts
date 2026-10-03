import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const FireVolumeDemo = defineAsyncComponent(() => import('./FireVolumeDemo.vue'))

const fireVolumeCase: DemoCard = {
  id: 'volume-fire',
  title: '灾害分析-火灾烟气与温度三维体',
  category: 'data',
  description:
    '城市建筑火灾态势研判工作台：事件驱动的多火源（主火 / 引燃 / 飞火）按时间曲线成长，浮升烟羽在环境风驱动下绕避三维建筑向下风向输运，生成温度 / 烟气浓度 / 能见度复合体场。支持复合态势 / 温度场 / 烟气浓度 / 风险分级四种显示模式，三维建筑与道路骨架、火源火焰柱、环境风网格箭头、疏散指引与距离标尺，T+ 事件阶段时间轴、危险温度与烟气阈值等值面、火源垂向剖面、风险分级体积、危险 / 烟气体积、烟羽顶高、下风向影响距离与建筑受威胁度统计。',
  tag: '灾害体渲染',
  icon: iconUrl,
  updatedAt: '2026-10-03',
  component: FireVolumeDemo
}

export default fireVolumeCase
