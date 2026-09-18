import type { PlottingKind } from '../index'

export type GPoint = { lng: number; lat: number; alt: number }

export const PLOT_ENTITY_PREFIX = 'military-plotting-'
export const PLOT_HANDLE_PREFIX = 'plot-edit-handle-'

export function isPlotEntityId(id: string | undefined): boolean {
  return !!id && id.startsWith(PLOT_ENTITY_PREFIX)
}

export function isHandleId(id: string | undefined): boolean {
  return !!id && id.startsWith(PLOT_HANDLE_PREFIX)
}

export type EditTool = 'select' | 'vertex' | 'move' | 'rotate' | 'scale'

export function kindName(kind: PlottingKind): string {
  const names: Partial<Record<PlottingKind, string>> = {
    'free-line': '自由线',
    polyline: '折线',
    curve: '曲线',
    'free-polygon': '自由面',
    polygon: '多边形',
    'regular-polygon': '正多边形',
    'straight-line-arrow': '直线箭头',
    'curve-line-arrow': '曲线箭头',
    'right-angle-arrow': '直角箭头',
    'swallowtail-arrow': '燕尾箭头',
    'pincer-arrow': '钳击箭头',
    'attack-arrow': '进攻箭头',
    'round-rectangle': '圆角矩形',
    sector: '扇形',
    bow: '弓形',
    'staging-area': '集结地',
    'flag-curve': '曲线旗标',
    'flag-rectangle': '矩形旗标',
    'flag-regular-triangle': '正三角旗标',
    'flag-inverted-triangle': '倒三角旗标',
    'flag-triangle': '对三角旗标'
  }
  return names[kind] ?? kind
}
