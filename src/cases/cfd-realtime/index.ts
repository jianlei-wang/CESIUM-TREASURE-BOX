import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const CfdRealtimeDemo = defineAsyncComponent(() => import('./CfdRealtimeDemo.vue'))

const cfdRealtimeCase: DemoCard = {
  id: 'cfd-realtime',
  title: '实时三维 CFD 仿真',
  category: 'geo',
  updatedAt: '2026-09-11',
  tag: '大气环境',
  description:
    '基于 LBM-D3Q19 在 Cesium 中实时计算城市风场：米色白模体素化为障碍物，入口注入彩虹示踪射流并做多层切片三维体渲染，绕流后形成湍流尾迹；可调风向风速、松弛时间与网格，并叠加切片、等值面与流线粒子，支持暂停/重置与宏观量导出。',
  component: CfdRealtimeDemo,
  icon: iconUrl
}

export default cfdRealtimeCase
