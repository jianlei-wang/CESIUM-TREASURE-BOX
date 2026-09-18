import type { Component } from 'vue'
import {
  Box,
  Compass,
  DataBoard,
  DataLine,
  Drizzling,
  Grid,
  Location,
  MagicStick,
  PartlyCloudy,
  ScaleToOriginal,
  Setting,
  Star,
  Sunny,
  TrendCharts
} from '@element-plus/icons-vue'
import type { CaseCategory } from './types'
import { caseLoaders, demos, type CaseMeta } from './manifest'

export { caseLoaders, demos, type CaseMeta } from './manifest'

export type { CaseCategory, DemoCard } from './types'

export const categories: CaseCategory[] = [
  { id: 'effects', label: '三维特效', icon: TrendCharts },
  { id: 'weather', label: '天气特效', icon: PartlyCloudy },
  { id: 'particles', label: '粒子特效', icon: Star },
  { id: 'water', label: '水面效果', icon: Drizzling },
  { id: 'draw', label: '标记标绘', icon: Location },
  { id: 'measure', label: '空间测量', icon: ScaleToOriginal },
  { id: 'analysis', label: '空间分析', icon: DataLine },
  { id: 'data', label: '数据可视化', icon: Grid },
  { id: 'tiles', label: '三维数据加载', icon: Box },
  { id: 'scene', label: '场景示例', icon: Compass },
  { id: 'geo', label: '大气环境', icon: PartlyCloudy },
  { id: 'lighting', label: '光照效果', icon: Sunny },
  { id: 'widgets', label: '界面控件', icon: Setting },
  { id: 'datav', label: '可视化大屏', icon: DataBoard },
  { id: 'three', label: 'ThreeJS样例', icon: MagicStick }
]

export const totalCases = demos.length

/**
 * 按案例 id 惰性加载案例入口模块，返回其 DemoCard（含异步组件工厂）。
 * 仅打开案例时才触发对应 chunk 的下载与执行，首页不依赖任何案例模块。
 */
export async function loadCaseEntry(id: string): Promise<{ meta?: CaseMeta; component?: Component } | undefined> {
  const loader = caseLoaders[id]
  if (!loader) return undefined
  const mod = await loader()
  const meta = demos.find((d) => d.id === id)
  return { meta, component: mod.default.component }
}
