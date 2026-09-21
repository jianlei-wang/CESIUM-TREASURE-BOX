import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CosmicStarTrailsDemo = defineAsyncComponent(() => import('./CosmicStarTrailsDemo.vue'))

const cosmicStarTrailsCase: DemoCard = {
  id: 'cosmic-startrails',
  title: 'VFX 银河星轨延时',
  category: 'particles',
  icon,
  description:
    '以真实地球为观测基底的夜景长曝光：观测锚点落在真实地表，天极方向由观测纬度决定，星点绕天极轴旋转并在曝光时长内拖出同心圆弧轨迹，天极高度严格等于当地纬度；天顶半径约 0.05 Re 的天球仅保留地平线以上半球，地平以下由压暗后的真实地球影像作为夜间地景与剪影，星轨被真实地平线正确截断，地平附近受大气消光偏红偏暗。画面叠加银河、城市光污染穹顶与偶尔划过的流星，曝光周期循环时星轨从无到有生长。曝光时长、观测纬度、星数、星轨亮度、星点尺寸、循环周期、流星频率、城市辉光与天空配色均可实时调整',
  tag: 'Three.js, 天文坐标, 长曝光模拟',
  component: CosmicStarTrailsDemo,
  updatedAt: '2026-09-21'
}

export default cosmicStarTrailsCase
