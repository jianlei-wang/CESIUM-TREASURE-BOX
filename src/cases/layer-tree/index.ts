import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const Demo = defineAsyncComponent(() => import('./Demo.vue'))
import iconUrl from './icon.webp'

const layerTreeCase: DemoCard = {
  id: 'layer-tree',
  title: '标准图层树控件',
  category: 'widgets',
  description:
    '严格按照 Cesium 图层树控件设计实现：统一数据模型与适配器架构，集中管理影像、地形、3D Tiles、数据源、实体、图元、模型、粒子等图层，支持分组、显隐、透明度、拖拽排序、搜索、右键菜单、快捷键、定位飞行与配置导出。',
  tag: '图层管理',
  icon: iconUrl,
  component: Demo,
  updatedAt: '2026-09-10'
}

export default layerTreeCase
