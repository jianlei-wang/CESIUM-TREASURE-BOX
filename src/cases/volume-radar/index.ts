import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const RadarVolumeDemo = defineAsyncComponent(() => import('./RadarVolumeDemo.vue'))

const radarVolumeCase: DemoCard = {
  id: 'volume-radar',
  title: '气象可视化-三维雷达回波与对流分析',
  category: 'data',
  description:
    '面向雷达业务的天气雷达回波体分析工作台：在 Web Worker 中按雷达站极坐标覆盖场（距离圈、波束抬升、体域边界、站顶静锥区、径向衰减、螺旋雨带）解析生成反射率 dBZ 体数据，经 VoxelProvider 组织为八级瓦片交给单个 VoxelPrimitive 做 GPU 光线步进，配合业务分级传递函数（分段 RGB + 分段 Alpha）分辨 20/35/45/55 dBZ 回波。支持回波顶高统计、强对流核心提取（顶高阈值与核心阈值解耦）、35/45 dBZ 等值面、地面覆盖与回波顶高平面图层、雷达站/距离圈/方位标注/顶高参考环、时间演变曲线（最大 dBZ / 最高顶高 / ≥35dBZ 面积）、高度带裁剪、任意方向剖切与 PNG 导出、相机预设与最强核心聚焦，以及鼠标悬浮体素拾取反射率、经纬高与业务单位。',
  tag: '雷达体渲染',
  icon: iconUrl,
  updatedAt: '2026-09-30',
  component: RadarVolumeDemo
}

export default radarVolumeCase
