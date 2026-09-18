import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const GeoserverLayerDemo = defineAsyncComponent(() => import('./GeoserverLayerDemo.vue'))
import icon from './icon.webp'

const geoserverLayerCase: DemoCard = {
  id: 'geoserver-layer',
  title: 'GeoServer 指定图层',
  category: 'tiles',
  description: '直接加载指定的 WMS / WFS / WMTS 图层服务',
  tag: '地图服务',
  icon,
  component: GeoserverLayerDemo
}

export default geoserverLayerCase
