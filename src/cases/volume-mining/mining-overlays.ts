/**
 * 三维矿体品位场景叠加 —— 钻孔轨迹（孔口—孔底）、孔口样品标注与露天采坑台阶轮廓。
 * 叠加对象全部挂到引擎的通用注记层，生命周期随案例组件销毁统一释放。
 */

import { Color } from 'cesium'
import type { LineOverlayResult, VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import { MINING_CONFIG } from '../../lib/volume-engine/scenes'
import { buildTransferLut } from '../../lib/volume-engine/palette'
import type { MiningElement } from './mining-analysis'

export type MiningOverlayState = {
  channel: MiningElement
  cutoff: number
  drillholesVisible: boolean
  benchesVisible: boolean
  activeDrillholeId?: string
}

export type MiningOverlayHandle = {
  update(state: MiningOverlayState): void
  destroy(): void
}

const BENCH_INSET_TOP = 0.36
const BENCH_INSET_BOTTOM = 0.1

export function installMiningOverlay(engine: VolumeEngine): MiningOverlayHandle {
  const v = engine.spec.volume
  const domain = MINING_CONFIG.domain

  function gradeColor(channel: MiningElement, value: number): Color {
    const el = MINING_CONFIG.elements[channel]
    const lut = buildTransferLut(el.palette)
    const t = Math.max(0, Math.min(1, value / Math.max(1e-6, el.max)))
    const idx = Math.round(t * 255)
    return new Color(lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255, 0.95)
  }

  function drawBenches(visible: boolean): void {
    if (!visible) {
      engine.setLines(undefined)
      return
    }
    const benches = MINING_CONFIG.benches
    const n = benches.length
    const positions: number[] = []
    const offsets: number[] = [0]
    for (let i = 0; i < n; i += 1) {
      const t = n > 1 ? i / (n - 1) : 0
      const half = BENCH_INSET_TOP - (BENCH_INSET_TOP - BENCH_INSET_BOTTOM) * t
      const z = 1 - benches[i] / domain.depth
      const cx = 0.5
      const cy = 0.5
      const corners = [
        [cx - half, cy - half],
        [cx + half, cy - half],
        [cx + half, cy + half],
        [cx - half, cy + half],
        [cx - half, cy - half]
      ]
      for (const [x, y] of corners) {
        const p = engine.localFromNormalized(x, y, z)
        positions.push(p.x, p.y, p.z)
      }
      offsets.push(positions.length / 3)
    }
    const result: LineOverlayResult = {
      positions: new Float32Array(positions),
      offsets: new Uint32Array(offsets),
      speeds: new Float32Array(offsets.length - 1).fill(1)
    }
    engine.setLines(result, { color: '#8fa4bd', width: 1.6, alphaStart: 0.9, alphaEnd: 0.9 })
  }

  function drawDrillholes(visible: boolean, channel: MiningElement, activeId?: string): void {
    if (!visible) {
      engine.clearOverlayPoints()
      return
    }
    const holes = MINING_CONFIG.drillholes
    const positions: number[] = []
    const offsets: number[] = [0]
    for (const hole of holes) {
      const top = engine.localFromNormalized(hole.x, hole.y, 1)
      const bottom = engine.localFromNormalized(hole.x, hole.y, Math.max(0.01, 1 - hole.depth / domain.depth))
      positions.push(top.x, top.y, top.z, bottom.x, bottom.y, bottom.z)
      offsets.push(positions.length / 3)
    }
    const lines: LineOverlayResult = {
      positions: new Float32Array(positions),
      offsets: new Uint32Array(offsets),
      speeds: new Float32Array(offsets.length - 1).fill(1)
    }
    engine.setLines(lines, { color: '#e8c46a', width: 3, widthStart: 1.5, alphaStart: 0.55, alphaEnd: 0.95 })

    engine.setOverlayPoints(
      holes.map((hole) => {
        const active = hole.id === activeId
        return {
          position: engine.localFromNormalized(hole.x, hole.y, 1),
          color: gradeColor(channel, hole.grade[channel]),
          pixelSize: active ? 12 : 9,
          label: hole.id,
          labelColor: active ? Color.WHITE : Color.fromCssColorString('#f3e6c2')
        }
      })
    )
  }

  return {
    update(state: MiningOverlayState): void {
      drawBenches(state.benchesVisible)
      drawDrillholes(state.drillholesVisible, state.channel, state.activeDrillholeId)
    },
    destroy(): void {
      engine.setLines(undefined)
      engine.clearOverlayPoints()
    }
  }
}
