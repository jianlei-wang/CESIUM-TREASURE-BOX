/**
 * 洪水动力水深体场景叠加 —— 河道中心线、水文站与受影响对象（城区 / 村落 / 农田 / 基础设施）。
 */

import { Color } from 'cesium'
import type { LineOverlayResult, VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import { FLOOD_CONFIG } from '../../lib/volume-engine/scenes'

export type FloodOverlayState = {
  riverVisible: boolean
  gaugesVisible: boolean
  zonesVisible: boolean
  activeZoneId?: string
}

export type FloodOverlayHandle = {
  update(state: FloodOverlayState): void
  destroy(): void
}

const ZONE_COLORS: Record<string, string> = {
  city: '#3d8bfd',
  village: '#f2c94c',
  farm: '#27ae60',
  infra: '#eb5757'
}

const ZONE_LABELS: Record<string, string> = {
  city: '城区',
  village: '村落',
  farm: '农田',
  infra: '基础设施'
}

function riverY(x: number): number {
  return 0.5 + 0.16 * Math.sin(x * 3.6) + 0.05 * Math.sin(x * 9.1)
}

export function installFloodOverlay(engine: VolumeEngine): FloodOverlayHandle {
  function drawRiver(visible: boolean): void {
    if (!visible) {
      engine.setLines(undefined)
      return
    }
    const positions: number[] = []
    const offsets: number[] = [0]
    const steps = 80
    for (let i = 0; i <= steps; i += 1) {
      const x = 0.02 + (0.96 * i) / steps
      const p = engine.localFromNormalized(x, Math.max(0.02, Math.min(0.98, riverY(x))), 0.04)
      positions.push(p.x, p.y, p.z)
    }
    offsets.push(positions.length / 3)
    const result: LineOverlayResult = {
      positions: new Float32Array(positions),
      offsets: new Uint32Array(offsets),
      speeds: new Float32Array([1])
    }
    engine.setLines(result, { color: '#39a0ff', width: 4, widthStart: 2.5, alphaStart: 0.5, alphaEnd: 0.95 })
  }

  function drawPoints(visible: boolean, activeZoneId?: string): void {
    if (!visible) {
      engine.clearOverlayPoints()
      return
    }
    const points = [
      ...FLOOD_CONFIG.gauges.map((g) => ({
        position: engine.localFromNormalized(g.x, Math.max(0.02, Math.min(0.98, riverY(g.x))), 0.05),
        color: Color.fromCssColorString('#65d3eb').withAlpha(0.95),
        pixelSize: 10,
        label: g.id,
        labelColor: Color.fromCssColorString('#cfeaff')
      })),
      ...FLOOD_CONFIG.zones.map((z) => {
        const active = z.id === activeZoneId
        return {
          position: engine.localFromNormalized(z.x, z.y, 0.02),
          color: Color.fromCssColorString(ZONE_COLORS[z.kind] ?? '#3d8bfd').withAlpha(active ? 1 : 0.85),
          pixelSize: Math.max(9, Math.min(22, Math.round(z.r * 220))),
          label: `${z.name}(${ZONE_LABELS[z.kind]})`,
          labelColor: active ? Color.WHITE : Color.fromCssColorString('#e6f0fb')
        }
      })
    ]
    engine.setOverlayPoints(points)
  }

  return {
    update(state: FloodOverlayState): void {
      drawRiver(state.riverVisible)
      drawPoints(state.gaugesVisible || state.zonesVisible, state.activeZoneId)
    },
    destroy(): void {
      engine.setLines(undefined)
      engine.clearOverlayPoints()
    }
  }
}
