import type { FlowBuffer } from '../core/buffer'

export type FlowArc = {
  originLon: number
  originLat: number
  destLon: number
  destLat: number
  value: number
  count: number
  category: number
}

export type FlowAggregateOptions = {
  /** 起终点吸附到多少度网格（区域聚合）。 */
  cellSize?: number
  /** 返回流量最大的前 N 条；0 表示全部。 */
  top?: number
  /** 最小流量过滤。 */
  minValue?: number
}

/** OD 流量聚合：按起终点网格归并，返回 Top N 弧线。 */
export function aggregateFlows(flow: FlowBuffer, options: FlowAggregateOptions = {}): FlowArc[] {
  const cellSize = options.cellSize ?? 0.5
  const buckets = new Map<string, FlowArc>()
  for (let i = 0; i < flow.length; i += 1) {
    const value = flow.values[i]
    if (options.minValue !== undefined && value < options.minValue) continue
    const oLon = Math.round(flow.originLon[i] / cellSize) * cellSize
    const oLat = Math.round(flow.originLat[i] / cellSize) * cellSize
    const dLon = Math.round(flow.destLon[i] / cellSize) * cellSize
    const dLat = Math.round(flow.destLat[i] / cellSize) * cellSize
    const key = `${oLon},${oLat}->${dLon},${dLat}`
    let arc = buckets.get(key)
    if (!arc) {
      arc = { originLon: oLon, originLat: oLat, destLon: dLon, destLat: dLat, value: 0, count: 0, category: flow.categories[i] }
      buckets.set(key, arc)
    }
    arc.value += value
    arc.count += 1
  }
  const arcs = [...buckets.values()].sort((a, b) => b.value - a.value)
  if (options.top && options.top > 0) return arcs.slice(0, options.top)
  return arcs
}

/** 按起点统计的枢纽排行（Top N 节点）。 */
export function flowHubs(flow: FlowBuffer, top = 10): Array<{ lon: number; lat: number; value: number }> {
  const map = new Map<string, { lon: number; lat: number; value: number }>()
  const cellSize = 0.5
  for (let i = 0; i < flow.length; i += 1) {
    const lon = Math.round(flow.originLon[i] / cellSize) * cellSize
    const lat = Math.round(flow.originLat[i] / cellSize) * cellSize
    const key = `${lon},${lat}`
    let hub = map.get(key)
    if (!hub) {
      hub = { lon, lat, value: 0 }
      map.set(key, hub)
    }
    hub.value += flow.values[i]
  }
  return [...map.values()].sort((a, b) => b.value - a.value).slice(0, top)
}
