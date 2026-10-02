import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const Pm25VolumeDemo = defineAsyncComponent(() => import('./Pm25VolumeDemo.vue'))

const pm25VolumeCase: DemoCard = {
  id: 'volume-pm25',
  title: '环境可视化-城市 PM2.5 浓度场与污染输运分析',
  category: 'data',
  description:
     '面向大气环境业务的三维 PM2.5 浓度场与污染输运分析工作台：在 Web Worker 中以固定污染源清单（工业烟囱 / 城区面源 / 道路线源）与气象条件（风向风速 / 幂律风切变 / 边界层高度 / 大气稳定度）驱动解析高斯烟羽场，风切变使羽流随高度向下风向倾斜，各污染物通道采用独立横向/垂直扩散系数；多级瓦片 VoxelProvider 供给单个 VoxelPrimitive 做 GPU 光线步进，配合 PM2.5 专属着色器（Beer-Lambert 消光 + 梯度边界增强 + 置信度调制）表达污染空间结构。支持 PM2.5 / PM10 / NO₂ 多污染物切换、35/75/115/150/250 国标分级、环境影响统计（超标面积与体积、地面峰值与 P95、分阈体积、污染柱顶高、人口暴露示例估算）、浓度-IAQI 对照、地面 footprint 热力与分级边界、污染热点提取、点击源贡献解析与垂直廓线、三污染物点位拾取、监测站模型-观测误差评估（RMSE / 偏差 / 相关系数）与监测同化订正、时间演变趋势曲线、1×/2×/4× 倍速回放、35/75/150/250 四档关键浓度等值面、动态质量档、任意方向剖切与 PNG 导出，以及相机预设与体素拾取浓度。',
  tag: '污染体渲染',
  icon: iconUrl,
  updatedAt: '2026-10-02',
  component: Pm25VolumeDemo
}

export default pm25VolumeCase
