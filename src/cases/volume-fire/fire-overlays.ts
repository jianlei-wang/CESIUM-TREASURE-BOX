/**
 * 火灾环境风叠加层 —— 在体域近地面铺设规则网格的风向箭头，并沿主火源标注
 * 下风向输运方向，直观呈现烟气抬升后被环境风驱动扩散的路径。
 *
 * 三维建筑、火源火焰柱、道路与疏散指引由 fire-engineering 工程层负责。
 */

import { Color } from 'cesium'
import type { LineOverlayResult, VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import { FIRE_CONFIG } from '../../lib/volume-engine/scenes'

export type FireOverlayState = {
  windVisible: boolean
  windDir: number
  windSpeed: number
  /** 下风向影响距离（米），0 表示不绘制 */
  downwindM?: number
}

export type FireOverlayHandle = {
  update(state: FireOverlayState): void
  destroy(): void
}

const GRID = 7

export function installFireOverlay(engine: VolumeEngine): FireOverlayHandle {
  const v = engine.spec.volume
  const main = FIRE_CONFIG.sources[0]

  function drawWind(state: FireOverlayState): void {
    if (!state.windVisible) {
      engine.setLines(undefined)
      return
    }
    const flow = ((state.windDir + 180) * Math.PI) / 180
    const dx = Math.cos(flow)
    const dy = Math.sin(flow)
    // 箭头长度随风速变化，映射到体域尺度的 6%~14%
    const len = 0.06 + 0.08 * Math.min(1, state.windSpeed / 12)
    const positions: number[] = []
    const offsets: number[] = [0]
    for (let iy = 0; iy < GRID; iy += 1) {
      for (let ix = 0; ix < GRID; ix += 1) {
        const x = 0.08 + (0.84 * ix) / (GRID - 1)
        const y = 0.08 + (0.84 * iy) / (GRID - 1)
        const z = 0.05 + 0.22 * ((ix + iy) % 3) / 2
        const a = engine.localFromNormalized(x, y, z)
        const b = engine.localFromNormalized(
          Math.max(0.01, Math.min(0.99, x + dx * len)),
          Math.max(0.01, Math.min(0.99, y + dy * len)),
          z
        )
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
        // 箭头翼
        const wing = len * 0.32
        const wx = Math.cos(flow + 2.5) * wing
        const wy = Math.sin(flow + 2.5) * wing
        const wx2 = Math.cos(flow - 2.5) * wing
        const wy2 = Math.sin(flow - 2.5) * wing
        const tipX = Math.max(0.01, Math.min(0.99, x + dx * len))
        const tipY = Math.max(0.01, Math.min(0.99, y + dy * len))
        const w1 = engine.localFromNormalized(
          Math.max(0.01, Math.min(0.99, tipX + wx)),
          Math.max(0.01, Math.min(0.99, tipY + wy)),
          z
        )
        const w2 = engine.localFromNormalized(
          Math.max(0.01, Math.min(0.99, tipX + wx2)),
          Math.max(0.01, Math.min(0.99, tipY + wy2)),
          z
        )
        positions.push(b.x, b.y, b.z, w1.x, w1.y, w1.z)
        offsets.push(positions.length / 3)
        positions.push(b.x, b.y, b.z, w2.x, w2.y, w2.z)
        offsets.push(positions.length / 3)
      }
    }
    // 下风向影响距离指示线
    if (state.downwindM && state.downwindM > 0) {
      const dNorm = Math.min(0.98, state.downwindM / Math.max(1, v.width))
      const a = engine.localFromNormalized(main.x, main.y, 0.03)
      const b = engine.localFromNormalized(
        Math.max(0.01, Math.min(0.99, main.x + Math.cos(flow) * dNorm)),
        Math.max(0.01, Math.min(0.99, main.y + Math.sin(flow) * dNorm)),
        0.03
      )
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      offsets.push(positions.length / 3)
    }
    if (!positions.length) {
      engine.setLines(undefined)
      return
    }
    const result: LineOverlayResult = {
      positions: new Float32Array(positions),
      offsets: new Uint32Array(offsets),
      speeds: new Float32Array(offsets.length - 1).fill(state.windSpeed)
    }
    engine.setLines(result, { color: '#7ee0ff', width: 1.8, widthStart: 1.1, alphaStart: 0.35, alphaEnd: 0.9 })
  }

  return {
    update(state: FireOverlayState): void {
      drawWind(state)
    },
    destroy(): void {
      engine.setLines(undefined)
    }
  }
}
