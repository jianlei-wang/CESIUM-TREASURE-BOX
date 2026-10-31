import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const SkyAtmosLightDemo = defineAsyncComponent(() => import('./SkyAtmosLightDemo.vue'))

const skyAtmosLightCase: DemoCard = {
  id: 'sky-atmos-light',
  title: '天气特效-云隙光束',
  category: 'weather',
  description:
    '在体积云基础上演示云隙光与大气散射：切换独立体积光与云底薄层光两种光路，调整介质密度、散射亮度、方向性与积分质量，或调节薄层的近地雾强度、日光直射增益与色彩，并结合 UTC 时间观察太阳方位变化对光束的影响。',
  tag: '天气系统',
  component: SkyAtmosLightDemo,
  updatedAt: '2026-10-31'
}

export default skyAtmosLightCase
