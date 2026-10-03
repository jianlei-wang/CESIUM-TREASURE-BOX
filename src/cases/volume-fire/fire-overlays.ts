/**
 * 火灾烟气与温度体场景叠加 —— 火源、周边建筑受威胁着色、环境风箭头与疏散方向线。
 */

import { Color } from 'cesium'
import type { LineOverlayResult, VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import { FIRE_CONFIG } from '../../lib/volume-engine/scenes'
import type { FireImpact } from './fire-analysis'

export type FireOverlayState = {
  sourcesVisible: boolean
  buildingsVisible: boolean
  windVisible: boolean
  escapeVisible: boolean
  impacts: FireImpact[]
  tempThreshold: number
  smokeThreshold: number
  windDir: number
}

export type FireOverlayHandle = {
  update(state: FireOverlayState): void
  destroy(): void
}

const SOURCE_COLORS = ['#ff3b1f', '#ff7a2f', '#ffb347']

export function installFireOverlay(engine: VolumeEngine): FireOverlayHandle {
  const v = engine.spec.volume
  const main = FIRE_CONFIG.sources[0]

  function drawLines(windVisible: boolean, escapeVisible: boolean, windDir: number): void {
    const positions: number[] = []
    const offsets: number[] = [0]
    let nextColor = '#ffd21e'
    if (escapeVisible) {
      const escapeDir = (windDir * Math.PI) / 180
      const a = engine.localFromNormalized(main.x, main.y, 0.05)
      const ex = Math.max(0.03, Math.min(0.97, main.x + (Math.cos(escapeDir) * 0.26 * v.width) / v.width))
      const ey = Math.max(0.03, Math.min(0.97, main.y + (Math.sin(escapeDir) * 0.26 * v.depth) / v.depth))
      const b = engine.localFromNormalized(ex, ey, 0.05)
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      offsets.push(positions.length / 3)
      nextColor = '#7ee787'
    }
    if (windVisible) {
      const flow = ((windDir + 180) * Math.PI) / 180
      const a = engine.localFromNormalized(0.5, 0.5, 0.6)
      const b = engine.localFromNormalized(0.5 + Math.cos(flow) * 0.24, 0.5 + Math.sin(flow) * 0.24, 0.6)
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      offsets.push(positions.length / 3)
    }
    if (positions.length === 0) {
      engine.setLines(undefined)
      return
    }
    const result: LineOverlayResult = {
      positions: new Float32Array(positions),
      offsets: new Uint32Array(offsets),
      speeds: new Float32Array(offsets.length - 1).fill(1)
    }
    engine.setLines(result, { color: nextColor, width: 3.4, widthStart: 1.4, alphaStart: 0.5, alphaEnd: 0.95 })
  }

  function drawPoints(state: FireOverlayState): void {
    const points: { position: ReturnType<VolumeEngine['localFromNormalized']>; color: Color; pixelSize: number; label: string; labelColor: Color }[] = []
    if (state.sourcesVisible) {
      FIRE_CONFIG.sources.forEach((s, i) => {
        points.push({
          position: engine.localFromNormalized(s.x, s.y, 0.06),
          color: Color.fromCssColorString(SOURCE_COLORS[i % SOURCE_COLORS.length]).withAlpha(0.95),
          pixelSize: 10 + Math.round(s.fuel * 6),
          label: s.name,
          labelColor: Color.fromCssColorString('#ffd9c2')
        })
      })
    }
    if (state.buildingsVisible) {
      const byId = new Map(state.impacts.map((im) => [im.id, im]))
      for (const b of FIRE_CONFIG.buildings) {
        const im = byId.get(b.id)
        const threat = im ? im.temp >= state.tempThreshold || im.smoke >= state.smokeThreshold : false
        points.push({
          position: engine.localFromNormalized(b.x, b.y, 0.05),
          color: threat ? Color.fromCssColorString('#ff3b1f').withAlpha(0.95) : Color.fromCssColorString('#7fb2e8').withAlpha(0.85),
          pixelSize: 8 + Math.min(8, Math.round(b.floors / 3)),
          label: `${b.name}${threat ? '!' : ''}`,
          labelColor: threat ? Color.fromCssColorString('#ffd9c2') : Color.fromCssColorString('#cfe0f0')
        })
      }
    }
    engine.setOverlayPoints(points)
  }

  return {
    update(state: FireOverlayState): void {
      drawPoints(state)
      drawLines(state.windVisible, state.escapeVisible, state.windDir)
    },
    destroy(): void {
      engine.setLines(undefined)
      engine.clearOverlayPoints()
    }
  }
}
