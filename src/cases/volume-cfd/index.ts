import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CfdVolumeDemo = defineAsyncComponent(() => import('./CfdVolumeDemo.vue'))

const cfdVolumeCase: DemoCard = {
  id: 'volume-cfd',
  title: '工程仿真-CFD 多物理场体可视化',
  category: 'data',
  description:
    '面向工程仿真的三维多物理场工作台：以程序化街区建筑白模为工程骨架，速度 / 压力 / 温度三场由同一解析流场模型一致生成，经多级瓦片 VoxelProvider 供给单个 VoxelPrimitive 做 GPU 光线步进，建筑内部体素自动标记为无效。支持迎风驻点高压、绕流加速、尾流回压低谷、热源热羽随流输运的联合表达，叠加仿真域、入口 / 出口边界、主风向与工程标注；提供 KPI 指标卡（来流 / 平均 / 峰值风速、压力极值、最高温度、超温区、热羽高度、尾流长度）、四组相机预设、速度 / 压力 / 温度多场切换、正负压双等值面、流线 / 粒子 / 剖面箭头三种向量表达、任意方向剖切、入射风速与热源温度调节与时间演化回放。',
  tag: 'CFD 工程工作台',
  icon,
  updatedAt: '2026-09-29',
  component: CfdVolumeDemo
}

export default cfdVolumeCase
