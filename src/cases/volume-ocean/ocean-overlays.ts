/**
 * 海洋温盐深三维体场景叠加 —— 观测站位（CTD）标记。
 */

import { Color } from 'cesium'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import { OCEAN_CONFIG } from '../../lib/volume-engine/scenes'

export type OceanOverlayState = {
  stationsVisible: boolean
  activeStationId?: string
}

export type OceanOverlayHandle = {
  update(state: OceanOverlayState): void
  destroy(): void
}

export function installOceanOverlay(engine: VolumeEngine): OceanOverlayHandle {
  function draw(visible: boolean, activeId?: string): void {
    if (!visible) {
      engine.clearOverlayPoints()
      return
    }
    engine.setOverlayPoints(
      OCEAN_CONFIG.stations.map((st) => {
        const active = st.id === activeId
        return {
          position: engine.localFromNormalized(st.x, st.y, 1),
          color: active ? Color.WHITE : Color.fromCssColorString('#65d3eb').withAlpha(0.9),
          pixelSize: active ? 13 : 9,
          label: st.id,
          labelColor: active ? Color.fromCssColorString('#ffffff') : Color.fromCssColorString('#cfeaff')
        }
      })
    )
  }

  return {
    update(state: OceanOverlayState): void {
      draw(state.stationsVisible, state.activeStationId)
    },
    destroy(): void {
      engine.clearOverlayPoints()
    }
  }
}
