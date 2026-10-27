import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CimShadertoyTerrainDemo = defineAsyncComponent(() => import('./CimShadertoyTerrainDemo.vue'))

const cimShadertoyTerrainCase: DemoCard = {
  id: 'cim-shadertoy-terrain',
  title: '着色器地形沙盘',
  category: 'effects',
  description: '在片元着色器中用分形噪声生成山脉、海面与天空，实时光线步进成像',
  tag: 'Shader',
  icon,
  component: CimShadertoyTerrainDemo,
  updatedAt: '2026-10-25'
}

export default cimShadertoyTerrainCase
