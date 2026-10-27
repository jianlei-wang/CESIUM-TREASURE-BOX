import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CimVoxelVolumeDemo = defineAsyncComponent(() => import('./CimVoxelVolumeDemo.vue'))

const cimVoxelVolumeCase: DemoCard = {
  id: 'cim-voxel-volume',
  title: '体素云团光线步进',
  category: 'effects',
  description: '以三维噪声纹理作为密度场，在包围盒内步进积分出可调阈值的云团',
  tag: '体渲染',
  icon,
  component: CimVoxelVolumeDemo,
  updatedAt: '2026-10-25'
}

export default cimVoxelVolumeCase
