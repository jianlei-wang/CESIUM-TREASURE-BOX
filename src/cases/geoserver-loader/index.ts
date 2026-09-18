import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const GeoserverLoaderDemo = defineAsyncComponent(() => import('./GeoserverLoaderDemo.vue'))
import icon from './icon.webp'

const geoserverLoaderCase: DemoCard = {
  id: 'geoserver-loader',
  title: 'GeoServer 服务加载',
  category: 'tiles',
  description: '加载 WMS / WFS / WMTS 地图服务并管理图层',
  tag: '地图服务',
  icon,
  component: GeoserverLoaderDemo
}

export default geoserverLoaderCase
