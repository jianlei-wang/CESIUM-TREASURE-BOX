import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const GeoAtmosphereDemo = defineAsyncComponent(() => import('./GeoAtmosphereDemo.vue'))

const geoAtmosphereCase: DemoCard = {
  id: 'geo-atmosphere',
  title: '物理大气与动态曝光',
  category: 'geo',
  icon: iconUrl,
  description:
    'Bruneton 物理大气（预计算 LUT）以 Cesium 原生 PostProcessStage 注入：天空散射、大气透视、昼/夜/晨昏动态曝光与 ACES HDR 色调映射，天空光照随真实太阳位置（Simon1994 + ICRF）与相机当地太阳高度角变化，支持手动曝光、镜头光晕与原生地面光照开关',
  tag: '大气散射',
  component: GeoAtmosphereDemo,
  updatedAt: '2026-09-04'
}

export default geoAtmosphereCase
