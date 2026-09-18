import { defineAsyncComponent } from 'vue'
import icon from './icon.jpg'

const VoxelStrataDemo = defineAsyncComponent(() => import('./VoxelStrataDemo.vue'))

export default {
  id: 'voxel-strata',
  title: '三维体素-地层体素数据',
  icon,
  category: 'data',
  description: '地层体素数据：手写 VoxelProvider 生成规则体素网格，按深度分层岩性，支持网格密度、分层深度、体块尺寸与步长参数调整',
  tag: '体素渲染',
  component: VoxelStrataDemo
}
