import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const FlightTrackDemo = defineAsyncComponent(() => import('./FlightTrackDemo.vue'))
import icon from './icon.webp'

const flightTrackCase: DemoCard = {
  id: 'geo-flight-track',
  title: '空间分析-航班航迹外推',
  category: 'analysis',
  description:
    '根据历史航迹点计算地速、航向与爬升率，按等速与转弯率假设外推未来若干分钟的预测航迹，并以置信锥表现不确定性随时间增长，支持外推时长、转弯率与速度偏差调节。',
  tag: '航迹, 外推, 预测, 置信锥',
  component: FlightTrackDemo,
  icon,
  updatedAt: '2026-11-12'
}

export default flightTrackCase
