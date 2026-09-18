import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const TencentMapDemo = defineAsyncComponent(() => import('./TencentMapDemo.vue'))
import icon from './icon.webp'

const mapTencentCase: DemoCard = {
  id: 'map-tencent',
  title: '腾讯地图底图',
  category: 'scene',
  description:
    '腾讯电子地图与卫星影像两套方案，支持 GCJ02/WGS84 坐标系切换',
  tag: '地图底图',
  icon,
  component: TencentMapDemo
}

export default mapTencentCase
