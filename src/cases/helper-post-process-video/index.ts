import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const HelperPostProcessVideoDemo = defineAsyncComponent(() => import('./HelperPostProcessVideoDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-post-process-video',
  title: '图传-无人机 OSD 与链路画质',
  category: 'effects',
  description: '无人机 OSD 叠层、模拟图传噪点干扰与数字图传马赛克三种链路画质：模拟远距离无线图传的画面劣化与飞行数据叠加。',
  tag: '后期特效',
  icon,
  component: HelperPostProcessVideoDemo,
  updatedAt: '2026-11-01'
}

export default caseItem
