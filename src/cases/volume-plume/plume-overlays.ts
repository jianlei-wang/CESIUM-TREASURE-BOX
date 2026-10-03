/**
 * 地下水污染羽流场景叠加 —— 监测井网（源井 / 监测井 / 抽水井）与地下水流向箭头。
 * 叠加对象全部挂到引擎的通用注记层，生命周期随案例组件销毁统一释放。
 */

import { Color } from 'cesium'
import type { LineOverlayResult, VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import { PLUME_CONFIG } from '../../lib/volume-engine/scenes'

export type PlumeOverlayState = {
  flowVisible: boolean
  wellsVisible: boolean
  activeWellId?: string
}

export type PlumeOverlayHandle = {
  update(state: PlumeOverlayState): void
  destroy(): void
}

const WELL_COLORS: Record<string, string> = {
  source: '#ff5a3c',
  monitor: '#65d3eb',
  extract: '#7ee787'
}

const WELL_LABELS: Record<string, string> = {
  source: '污染源',
  monitor: '监测井',
  extract: '抽出井'
}

export function installPlumeOverlay(engine: VolumeEngine): PlumeOverlayHandle {
  const v = engine.spec.volume
  const flowRad = (PLUME_CONFIG.flowDir * Math.PI) / 180
  const sourceWell = PLUME_CONFIG.wells.find((w) => w.kind === 'source') ?? PLUME_CONFIG.wells[0]

  function drawFlow(visible: boolean): void {
    if (!visible) {
      engine.setLines(undefined)
      return
    }
    const a = engine.localFromNormalized(sourceWell.x, sourceWell.y, 0.5)
    const len = Math.min(v.width, v.depth) * 0.42
    const ex = sourceWell.x + (Math.cos(flowRad) * len) / v.width
    const ey = sourceWell.y + (Math.sin(flowRad) * len) / v.depth
    const b = engine.localFromNormalized(ex, ey, 0.5)
    const positions = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z])
    const result: LineOverlayResult = {
      positions,
      offsets: new Uint32Array([0, 2]),
      speeds: new Float32Array([1, 1])
    }
    engine.setLines(result, { color: '#ffd21e', width: 3.5, widthStart: 1.2 })
  }

  function drawWells(visible: boolean, activeWellId?: string): void {
    if (!visible) {
      engine.clearOverlayPoints()
      return
    }
    const points = PLUME_CONFIG.wells.map((well) => {
      const normZ = Math.max(0.02, Math.min(0.98, 1 - well.depth / v.height))
      const active = well.id === activeWellId
      return {
        position: engine.localFromNormalized(well.x, well.y, normZ),
        color: Color.fromCssColorString(WELL_COLORS[well.kind] ?? '#65d3eb').withAlpha(active ? 1 : 0.9),
        pixelSize: active ? 12 : 9,
        label: well.id,
        labelColor: active ? Color.WHITE : Color.fromCssColorString('#cfe5ff')
      }
    })
    engine.setOverlayPoints(points)
  }

  return {
    update(state: PlumeOverlayState): void {
      drawFlow(state.flowVisible)
      drawWells(state.wellsVisible, state.activeWellId)
    },
    destroy(): void {
      engine.setLines(undefined)
      engine.clearOverlayPoints()
    }
  }
}

export { WELL_LABELS }
