import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const BaiduMapDemo = defineAsyncComponent(() => import('./BaiduMapDemo.vue'))
import icon from './icon.webp'

const mapBaiduCase: DemoCard = {
  id: 'map-baidu',
  title: '百度地图底图',
  category: 'scene',
  description:
    '百度矢量地图与卫星影像两套方案，支持 BD09/WGS84 坐标系切换',
  tag: '地图底图',
  icon,
  component: BaiduMapDemo
}

export default mapBaiduCase
