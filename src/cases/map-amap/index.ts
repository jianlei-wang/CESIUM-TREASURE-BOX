import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const AmapMapDemo = defineAsyncComponent(() => import('./AmapMapDemo.vue'))
import icon from './icon.webp'

const mapAmapCase: DemoCard = {
  id: 'map-amap',
  title: '高德地图底图',
  category: 'scene',
  description:
    '高德电子地图与卫星影像+注记叠加两套方案，支持 GCJ02/WGS84 坐标系切换',
  tag: '地图底图',
  icon,
  component: AmapMapDemo
}

export default mapAmapCase
