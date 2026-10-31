import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const SkyAtmosQualityDemo = defineAsyncComponent(() => import('./SkyAtmosQualityDemo.vue'))

const skyAtmosQualityCase: DemoCard = {
  id: 'sky-atmos-quality',
  title: '天气特效-天空画质',
  category: 'weather',
  description:
    '聚焦天空渲染的成像与性能：比较 AgX、ACES、Reinhard 等色调映射曲线，调节曝光、地表增益与大气透视，开关 HBAO 环境光遮蔽、SMAA 抗锯齿、HDR 与对数深度缓冲，并通过距离降采样、相机高度淡出与降噪权重平衡画质和帧率。',
  tag: '天气系统',
  component: SkyAtmosQualityDemo,
  updatedAt: '2026-10-31'
}

export default skyAtmosQualityCase
