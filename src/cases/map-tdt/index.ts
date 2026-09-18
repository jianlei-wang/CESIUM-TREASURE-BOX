import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const TdtMapDemo = defineAsyncComponent(() => import('./TdtMapDemo.vue'))
import icon from './icon.webp'

const mapTdtCase: DemoCard = {
  id: 'map-tdt',
  title: '天地图底图',
  category: 'scene',
  description:
    '天地图矢量地图与影像+注记两套方案，Key 手动输入后按参数加载底图',
  tag: '地图底图',
  icon,
  component: TdtMapDemo
}

export default mapTdtCase
