import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const RiverChannelDemo = defineAsyncComponent(() => import('./RiverChannelDemo.vue'))

const riverChannelCase: DemoCard = {
  id: 'river-channel',
  title: '真实河道水面仿真',
  category: 'water',
  description:
    '在 Cesium 世界地形上还原真实河道水面：以黄河上游龙羊峡深切峡谷为锚点，按经纬度栅格采样真实地形高度，逐顶点计算「水面高程 − 河床高程」的水深并构建水平水面网格，地形高于水面处由着色器裁剪，河岸线因此沿真实等高线自然蜿蜒。水流方向不依赖人工指定：先用河道走廊掩膜的加权协方差（结构张量）求每个格点处的河道主轴作为流线切线，再由河床高程平滑势面的负梯度确定全局下游方向，从而统一流线的正负号，使水流始终沿河道走向并指向下游；流向以 GPU 动态箭头层连续滚动呈现，箭头方向实时贴合河道转弯，提供彗星/箭头/人字/短划/光点五种样式，密度、长度、宽度、速度、亮度与颜色均可实时调整。还可以在地图上直接手绘河道多边形来限定水面范围，水面与流场随即裁剪到该多边形内并按多边形内的地形重新估算水位。着色器按归一化水深在浅水区与深水区颜色/透明度间连续渐变，并以分形噪声导数构造切空间波法线叠加立体波纹，逐像素计算漫反射、镜面高光、太阳高光与菲涅尔反射；再以沿自动流向推进的分形噪声生成白浪，在浅滩与急流处聚集。水位、基础颜色/透明度、水深值、扭曲度、浅深水区颜色与透明度、菲涅尔反射色/系数、反射强度/混合度、水流速、流向偏转、白浪混合度/速度/缩放/强度、波高/振幅/密度/平滑/高光均可实时调整。',
  tag: 'Cesium, 世界地形, 水面着色器, 真实河道, 自动流向',
  component: RiverChannelDemo,
  updatedAt: '2026-09-21'
}

export default riverChannelCase
