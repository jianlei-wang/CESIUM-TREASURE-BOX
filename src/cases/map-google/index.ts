import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const GoogleMapDemo = defineAsyncComponent(() => import('./GoogleMapDemo.vue'))
import icon from './icon.webp'

const mapGoogleCase: DemoCard = {
  id: 'map-google',
  title: '谷歌地图底图',
  category: 'scene',
  description:
    '谷歌电子地图与卫星影像+注记叠加两套方案，支持 GCJ02/WGS84 坐标系切换',
  tag: '地图底图',
  icon,
  component: GoogleMapDemo
}

export default mapGoogleCase
