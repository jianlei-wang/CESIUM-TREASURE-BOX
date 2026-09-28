import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const RadarVolumeDemo = defineAsyncComponent(() => import('./RadarVolumeDemo.vue'))

const radarVolumeCase: DemoCard = {
  id: 'volume-radar',
  title: '气象可视化-三维雷达回波体',
  category: 'data',
  description:
    '把天气雷达反射率体数据放进真实三维地球场景：在 Web Worker 中按对流单体、回波顶高与风移解析生成 dBZ 场，经 VoxelProvider 组织为八叉树多级瓦片并交给单个 VoxelPrimitive 做 GPU 光线步进，配合 256 级传递函数纹理表达弱回波到强回波核心。支持反射率单位与阈值分级（20/35/45 dBZ）、值域、不透明度、覆盖基底、色带切换、光线步长、屏幕误差、最近邻采样、任意方向剖切（拖动低分辨率 / 松开高分辨率）、剖切面 PNG 导出、时间轴回放、对流单体数与风移速度调节，以及鼠标悬浮体素拾取反射率数值。',
  tag: '雷达体渲染',
  updatedAt: '2026-09-28',
  component: RadarVolumeDemo
}

export default radarVolumeCase
