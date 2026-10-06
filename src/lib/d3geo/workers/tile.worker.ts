/// <reference lib="webworker" />
import { decodeMvt, encodeMvt } from '../data/parsers/mvt'
import type { TileRequest, TileResponse } from './protocol'

self.onmessage = (event: MessageEvent<TileRequest>) => {
  const start = performance.now()
  const request = event.data
  let buffer: ArrayBuffer
  let encodedBytes: number | undefined
  if (request.geometries) {
    const encoded = encodeMvt(request.tileName ?? 'tile', request.extent ?? 4096, request.geometries)
    buffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
    encodedBytes = encoded.byteLength
  } else if (request.bytes) {
    buffer = request.bytes
  } else {
    buffer = new ArrayBuffer(0)
  }
  const tile = decodeMvt(buffer)
  const decoded: Array<{ type: 'Point' | 'LineString' | 'Polygon'; coordinates: number[][]; name: string }> = []
  for (const layer of tile.layers) {
    for (const feature of layer.features) {
      decoded.push({ type: feature.type, coordinates: feature.coordinates, name: String(feature.properties.name ?? layer.name) })
    }
  }
  const response: TileResponse = {
    id: request.id,
    layers: tile.layers.map((layer) => ({
      name: layer.name,
      extent: layer.extent,
      featureCount: layer.features.length,
      encodedBytes
    })),
    decoded,
    encodedBytes: encodedBytes ?? buffer.byteLength,
    elapsed: performance.now() - start
  }
  ;(self as unknown as Worker).postMessage(response)
}
