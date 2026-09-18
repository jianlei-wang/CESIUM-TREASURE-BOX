import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const GeoVisMapDemo = defineAsyncComponent(() => import('./GeoVisMapDemo.vue'))
import icon from './icon.webp'

const mapGeoVisCase: DemoCard = {
  id: 'map-geovis',
  title: '星图地图底图',
  category: 'scene',
  description:
    '星图矢量地图与卫星影像两套方案，token 手动输入后按参数加载底图',
  tag: '地图底图',
  icon,
  component: GeoVisMapDemo
}

export default mapGeoVisCase
