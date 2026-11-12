import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const SensorImagingDemo = defineAsyncComponent(() => import('./SensorImagingDemo.vue'))
import icon from './icon.webp'

const sensorImagingCase: DemoCard = {
  id: 'geo-sensor-imaging',
  title: '三维特效-传感器成像风格',
  category: 'effects',
  description:
    '对场景整体施加成像风格后处理，提供正常成像、热成像、微光夜视、暗光增强、棕褐与单色六种模式，可调增益、噪声、暗角、扫描线与光晕强度，正常成像模式保留原始画面以便对比，其余模式模拟光电传感设备在不同光谱下的成像观感。',
  tag: '成像风格, 后处理, 夜视, 热像',
  component: SensorImagingDemo,
  icon,
  updatedAt: '2026-11-12'
}

export default sensorImagingCase
