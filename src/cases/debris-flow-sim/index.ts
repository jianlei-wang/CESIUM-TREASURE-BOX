import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const DebrisFlowDemo = defineAsyncComponent(() => import('./DebrisFlowDemo.vue'))

const debrisFlowSimCase: DemoCard = {
  id: 'debris-flow-sim',
  title: 'GPU 泥石流地形侵蚀',
  category: 'analysis',
  description:
    '基于 Cesium World Terrain 的 GPU 泥石流地形侵蚀模拟：以 512×512 浮点纹理 Ping-Pong 运行二维浅水方程（MacCormack 二阶格式 + Well-Balanced 静水重构），叠加 Herschel-Bulkley-Papanastasiou 本构与超额剪切应力侵蚀沉积模型，支持笔刷注入水沙/障碍、参数实时调节与水深/流速/侵蚀多模式可视化',
  tag: 'SWE, 泥石流, GPGPU',
  component: DebrisFlowDemo,
  icon: iconUrl,
  updatedAt: '2026-09-12'
}

export default debrisFlowSimCase
