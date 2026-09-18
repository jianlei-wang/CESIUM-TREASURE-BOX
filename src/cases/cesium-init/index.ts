import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const CesiumInitDemo = defineAsyncComponent(() => import('./CesiumInitDemo.vue'))
import icon from './icon.webp'

const cesiumInitCase: DemoCard = {
  id: 'cesium-init',
  title: 'Cesium 初始化地球',
  category: 'scene',
  description: '创建第一个真实 Cesium Viewer 场景',
  tag: 'Cesium 基础',
  icon,
  component: CesiumInitDemo
}

export default cesiumInitCase
