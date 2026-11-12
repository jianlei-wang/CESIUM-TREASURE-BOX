import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const SensorCoverageDemo = defineAsyncComponent(() => import('./SensorCoverageDemo.vue'))

const sensorCoverageCase: DemoCard = {
  id: 'geo-sensor-coverage',
  title: '空间分析-摄像机覆盖范围',
  category: 'analysis',
  description:
    '按方位角、视场角、有效距离、俯仰与安装高度计算多台摄像设备的可见覆盖，支持拖动方向角与视场角实时重算，生成覆盖热度栅格并标注覆盖盲区与重叠区。',
  tag: '可见域, 覆盖, 摄像机, 视场角',
  component: SensorCoverageDemo,
  updatedAt: '2026-11-12'
}

export default sensorCoverageCase
