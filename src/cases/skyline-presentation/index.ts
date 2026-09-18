import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const SkylinePresentationDemo = defineAsyncComponent(() => import('./SkylinePresentationDemo.vue'))
import icon from './icon.webp'

const skylinePresentationCase: DemoCard = {
  id: 'skyline-presentation',
  title: '三维场景演示_基础版',
  category: 'scene',
  description: 'Skyline Presentation 演示引擎：路径漫游、时序图层调度、标注弹窗与播放控制',
  tag: '展示汇报',
  icon,
  component: SkylinePresentationDemo
}

export default skylinePresentationCase
