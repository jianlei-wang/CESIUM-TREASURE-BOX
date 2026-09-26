import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LowAltitudePlanningDemo = defineAsyncComponent(() => import('./LowAltitudePlanningDemo.vue'))

const lowAltitudePlanningCase: DemoCard = {
  id: 'low-altitude-planning',
  title: '低空规划系统 DEMO（系统设计技术路线）',
  category: 'system',
  icon,
  description:
    '基于 Cesium 1.144 的低空飞行服务保障一体化 Web3D 规划与管控系统 DEMO：顶部状态栏 + 左侧双栏 + 中央三维场景 + 右侧业务面板 + 底部功能栏的完整系统外壳，内置场景网格可视、空域管理、航线智能规划、模拟飞行、实时监控告警、数据与业务管理、系统管理七大交互模块。支持 GeoSOT（GB/T 39409）网格 L15–L19 分级生成与单值/分级/点云/热力多模式渲染、禁飞/限飞空域与建筑障碍叠加、A* 栅格避障 + Catmull-Rom 平滑的航点/面状/环绕航线规划与风险评估、Clock 时间轴模拟飞行与 HUD、虚拟设备巡飞航迹与越界/冲突/低电量实时告警，并可一键查看 P0–P3 四阶段 24 周实施路线图。',
  tag: 'Cesium 1.144, 低空规划, GeoSOT网格, 空域管理, A*航线规划, 模拟飞行, 实时监控, 系统DEMO',
  component: LowAltitudePlanningDemo,
  updatedAt: '2026-09-25'
}

export default lowAltitudePlanningCase
