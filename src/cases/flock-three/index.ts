import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const FlockThreeDemo = defineAsyncComponent(() => import('./FlockThreeDemo.vue'))

const flockThreeCase: DemoCard = {
  id: 'flock-three',
  title: 'Three.Quarks 群体编队',
  category: 'particles',
  description:
    '参考“鸟群 / 萤火虫 / 无人机编队灯光秀”方案：鸟群模式用 boids 分离/对齐/凝聚三规则配合空间哈希网格做邻域加速，并追随缓慢巡游的目标点；萤火虫模式以相位噪声随机游走并做亮度脉动；编队模式改为球面、平面、螺旋、波浪等确定性图案并用缓动插值完成队形变换。个体数、尺寸、速度、活动范围、感知半径、三项权重、队形、色相与亮度均可调整',
  tag: 'Three.js, three.quarks, boids, 群体智能',
  component: FlockThreeDemo,
  updatedAt: '2026-09-20'
}

export default flockThreeCase
