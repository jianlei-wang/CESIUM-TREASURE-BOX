import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const VolumeCloudDemo = defineAsyncComponent(() => import('./VolumeCloudDemo.vue'))
const volumeCloudCase: DemoCard = {
  id: 'volume-cloud',
  title: '空间分析-体积云效果',
  category: 'effects',
  description: '采用光线步进的球面体积云后处理，支持云层高度/厚度/覆盖率/密度、高云、光照、相位与大气透视等参数实时调节',
  tag: '空间分析',
  icon,
  component: VolumeCloudDemo,
  updatedAt: '2026-08-27'
}

export default volumeCloudCase
