/// <reference lib="webworker" />
import type { SpatialClusterRequest, SpatialClusterResponse } from './protocol'

self.onmessage = (event: MessageEvent<SpatialClusterRequest>) => {
  const start = performance.now()
  const { positions, cellSize } = event.data
  const size = Math.max(1e-6, cellSize)
  const length = positions.length / 2
  const assignments = new Int32Array(length)
  const indexByKey = new Map<string, number>()
  const sumLon: number[] = []
  const sumLat: number[] = []
  const counts: number[] = []
  for (let i = 0; i < length; i += 1) {
    const key = `${Math.floor(positions[i * 2] / size)},${Math.floor(positions[i * 2 + 1] / size)}`
    let cluster = indexByKey.get(key)
    if (cluster === undefined) {
      cluster = sumLon.length
      indexByKey.set(key, cluster)
      sumLon.push(0)
      sumLat.push(0)
      counts.push(0)
    }
    assignments[i] = cluster
    sumLon[cluster] += positions[i * 2]
    sumLat[cluster] += positions[i * 2 + 1]
    counts[cluster] += 1
  }
  const clusterCount = sumLon.length
  const clusterLon = new Float32Array(clusterCount)
  const clusterLat = new Float32Array(clusterCount)
  for (let c = 0; c < clusterCount; c += 1) {
    clusterLon[c] = sumLon[c] / counts[c]
    clusterLat[c] = sumLat[c] / counts[c]
  }
  const response: SpatialClusterResponse = {
    id: event.data.id,
    clusterCount,
    assignments,
    clusterLon,
    clusterLat,
    elapsed: performance.now() - start
  }
  ;(self as unknown as Worker).postMessage(response, [assignments.buffer, clusterLon.buffer, clusterLat.buffer])
}
