import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const UavTestFieldDemo = defineAsyncComponent(() => import('./UavTestFieldDemo.vue'))

const uavTestFieldCase: DemoCard = {
  id: 'uav-test-field',
  title: '无人机试飞场 3D 演示',
  category: 'three',
  icon,
  description:
    '纯 Three.js 构建的无人机试飞场三维可视化：园区跑道、起降场、拱顶机库、通导监气反保障设备与围墙办公区完整建模，无人机沿闭环航线自动巡航并可切换手动操控，内置 GB 42590-2023 的 17 项强制安全测试科目，逐项演示电子围栏、应急处置、结构强度、抗风性、灯光等测试流程与实时结果',
  tag: 'Three.js, 无人机, 试飞场, GB 42590',
  component: UavTestFieldDemo,
  updatedAt: '2026-09-18'
}

export default uavTestFieldCase
