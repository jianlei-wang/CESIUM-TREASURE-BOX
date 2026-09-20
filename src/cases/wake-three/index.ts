import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const WakeThreeDemo = defineAsyncComponent(() => import('./WakeThreeDemo.vue'))

const wakeThreeCase: DemoCard = {
  id: 'wake-three',
  title: 'VFX 船尾开尔文尾迹',
  category: 'particles',
  icon,
  description:
    '船体作为移动发射器，两条按开尔文角向斜后方发散的泡沫航迹在静止世界坐标中遗留形成 V 形尾迹，船艏喷射水花受重力回落。航速、泡沫量/尺寸/寿命、开尔文角、水花量与透明度均可实时调整',
  tag: 'Three.js, three.quarks, 粒子特效, 海洋',
  component: WakeThreeDemo,
  updatedAt: '2026-09-20'
}

export default wakeThreeCase
