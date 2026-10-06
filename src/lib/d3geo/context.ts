import { PointPrimitiveCollection, type CustomDataSource, type Viewer } from 'cesium'
import type { D3CaseContext, D3LegendItem, D3Settings } from './types'

export type D3ContextHost = {
  ctx: D3CaseContext
  /** 由外壳的 rAF 循环调用。 */
  runFrame: (time: number, delta: number) => void
  /** 清空案例产生的全部内容（实体 / 图元 / 覆盖层 / 帧回调）。 */
  reset: () => void
  /** 彻底销毁。 */
  dispose: () => void
}

export function createD3Context(options: {
  viewer: Viewer
  dataSource: CustomDataSource
  settings: D3Settings
  setStatus: (text: string) => void
  setLegend: (items: D3LegendItem[]) => void
}): D3ContextHost {
  const { viewer, dataSource, settings } = options
  const cleanupFns: Array<() => void> = []
  const overlays: HTMLElement[] = []
  const frameCallbacks = new Set<(time: number, delta: number) => void>()
  const trackedPrimitives: object[] = []

  const reset = () => {
    dataSource.entities.removeAll()
    for (const primitive of trackedPrimitives) {
      try {
        viewer.scene.primitives.remove(primitive as never)
      } catch {
        /* primitive may already be destroyed */
      }
    }
    trackedPrimitives.length = 0
    for (const overlay of overlays) overlay.remove()
    overlays.length = 0
    for (const fn of cleanupFns.splice(0)) {
      try {
        fn()
      } catch {
        /* ignore cleanup errors */
      }
    }
    frameCallbacks.clear()
  }

  const ctx: D3CaseContext = {
    viewer,
    dataSource,
    settings,
    status: options.setStatus,
    legend: options.setLegend,
    onFrame: (cb) => {
      frameCallbacks.add(cb)
      return () => frameCallbacks.delete(cb)
    },
    onCleanup: (fn) => {
      cleanupFns.push(fn)
    },
    overlay: (el) => {
      el.style.position = 'absolute'
      el.style.inset = '0'
      el.style.pointerEvents = 'none'
      viewer.container.appendChild(el)
      overlays.push(el)
    },
    pointCollection: () => {
      const collection = new PointPrimitiveCollection()
      viewer.scene.primitives.add(collection)
      trackedPrimitives.push(collection)
      return collection
    },
    clear: reset
  }

  return {
    ctx,
    runFrame: (time, delta) => {
      for (const cb of frameCallbacks) cb(time, delta)
    },
    reset,
    dispose: reset
  }
}
