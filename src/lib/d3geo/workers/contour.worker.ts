/// <reference lib="webworker" />
import { contours } from 'd3-contour'
import type { ContourRequest, ContourResponse } from './protocol'

self.onmessage = (event: MessageEvent<ContourRequest>) => {
  const start = performance.now()
  const { width, height, values, thresholds } = event.data
  const generator = contours().size([width, height]).thresholds(thresholds)
  const shapes = generator(values as unknown as number[]) as unknown as Array<{ value: number; coordinates: number[][][][] }>
  const bands = shapes.map((shape) => ({
    value: shape.value,
    polygons: shape.coordinates
  }))
  const response: ContourResponse = { id: event.data.id, bands, elapsed: performance.now() - start }
  ;(self as unknown as Worker).postMessage(response)
}
