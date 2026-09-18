import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const GeoLensFlareDemo = defineAsyncComponent(() => import('./GeoLensFlareDemo.vue'))

const geoLensFlareCase: DemoCard = {
  id: 'geo-lensflare',
  title: '镜头光晕与高光',
  category: 'geo',
  description:
    'Cesium 原生 PostProcessStage 合成链：以深度遮挡采样真实反映太阳被山体/地物遮挡，灰度高光抠像生成轴向鬼影（Ghost）与柔光光晕（Halo），视线实时瞄准真实太阳方向（Simon1994 + ICRF）',
  tag: '镜头光晕',
  icon: iconUrl,
  component: GeoLensFlareDemo,
  updatedAt: '2026-09-04'
}

export default geoLensFlareCase
