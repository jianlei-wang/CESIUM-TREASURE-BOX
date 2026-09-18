import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const DustDispersionDemo = defineAsyncComponent(() => import('./DustDispersionDemo.vue'))

const dustDispersionCase: DemoCard = {
  id: 'dust-dispersion',
  title: '施工扬尘扩散模拟',
  category: 'geo',
  updatedAt: '2026-09-11',
  tag: '大气环境',
  icon,
  description:
    '基于高斯烟羽模型构建施工扬尘扩散模拟：支持点源/线源/面源/移动源多类型扬尘源、施工道路、物料堆场、土石方作业等场景，可调整风速风向、大气稳定度、源强、城市扩散修正与网格参数；提供水平切片热力面、垂直剖面、VoxelPrimitive 三维体渲染与粒子流场四种浓度场可视化方式，每个参数附有说明提示；支持分析过程时间轴追溯与浓度场回放，动态评估学校、医院、居民区等敏感点超标情况，量化洒水、覆盖、围挡、雾炮等防控措施减排效果，并支持分析报告在线预览（PDF）与 Word、PDF 导出。',
  component: DustDispersionDemo
}

export default dustDispersionCase
