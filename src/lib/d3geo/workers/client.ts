/**
 * Worker 客户端：主线程通过它把重计算迁移到 Web Worker，
 * 使用 Transferable TypedArray 避免大数据在主线程与 Worker 间复制。
 */
import type {
  AggregateRequest,
  AggregateResponse,
  ContourRequest,
  ContourResponse,
  SpatialClusterRequest,
  SpatialClusterResponse,
  TileRequest,
  TileResponse
} from './protocol'

type Pending<T> = { resolve: (value: T) => void; reject: (reason: unknown) => void; worker: Worker }

let aggregateWorker: Worker | undefined
let spatialWorker: Worker | undefined
let contourWorker: Worker | undefined
let tileWorker: Worker | undefined
let requestId = 0
const pending = new Map<number, Pending<unknown>>()

function spawn(url: URL): Worker {
  return new Worker(url, { type: 'module' })
}

function ensure<K extends keyof typeof urls>(kind: K): Worker {
  const urls = {
    aggregate: () => new URL('./aggregate.worker.ts', import.meta.url),
    spatial: () => new URL('./spatial.worker.ts', import.meta.url),
    contour: () => new URL('./contour.worker.ts', import.meta.url),
    tile: () => new URL('./tile.worker.ts', import.meta.url)
  }
  const existing =
    kind === 'aggregate' ? aggregateWorker : kind === 'spatial' ? spatialWorker : kind === 'contour' ? contourWorker : tileWorker
  if (existing) return existing
  const worker = spawn(urls[kind]())
  worker.onmessage = (event: MessageEvent<{ id: number }>) => {
    const entry = pending.get(event.data.id)
    if (entry) {
      pending.delete(event.data.id)
      entry.resolve(event.data)
    }
  }
  worker.onerror = (event) => {
    for (const [id, entry] of pending) {
      pending.delete(id)
      entry.reject(event.message)
    }
  }
  if (kind === 'aggregate') aggregateWorker = worker
  else if (kind === 'spatial') spatialWorker = worker
  else if (kind === 'contour') contourWorker = worker
  else tileWorker = worker
  return worker
}

function call<TRequest extends { id: number }, TResponse>(worker: Worker, request: TRequest, transfer: Transferable[]): Promise<TResponse> {
  const id = ++requestId
  request.id = id
  return new Promise<TResponse>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, worker })
    worker.postMessage(request, transfer)
  })
}

/** 空间聚合（hexbin / grid）在 Worker 中完成，主线程零计算。 */
export function aggregateInWorker(
  request: Omit<AggregateRequest, 'id'>,
  transfer: Transferable[] = [request.positions.buffer, request.values.buffer]
): Promise<AggregateResponse> {
  const worker = ensure('aggregate')
  return call<AggregateRequest, AggregateResponse>(worker, { ...request, id: 0 }, transfer)
}

/** 地理网格聚类在 Worker 中完成。 */
export function clusterInWorker(
  request: Omit<SpatialClusterRequest, 'id'>,
  transfer: Transferable[] = [request.positions.buffer]
): Promise<SpatialClusterResponse> {
  const worker = ensure('spatial')
  return call<SpatialClusterRequest, SpatialClusterResponse>(worker, { ...request, id: 0 }, transfer)
}

/** 等值线计算在 Worker 中完成。 */
export function contourInWorker(
  request: Omit<ContourRequest, 'id'>,
  transfer: Transferable[] = [request.values.buffer]
): Promise<ContourResponse> {
  const worker = ensure('contour')
  return call<ContourRequest, ContourResponse>(worker, { ...request, id: 0 }, transfer)
}

/** MVT/PBF 编解码在 Worker 中完成。 */
export function tileInWorker(request: Omit<TileRequest, 'id'>, transfer: Transferable[] = []): Promise<TileResponse> {
  const worker = ensure('tile')
  return call<TileRequest, TileResponse>(worker, { ...request, id: 0 }, transfer)
}

export function disposeWorkers(): void {
  aggregateWorker?.terminate()
  spatialWorker?.terminate()
  contourWorker?.terminate()
  tileWorker?.terminate()
  aggregateWorker = undefined
  spatialWorker = undefined
  contourWorker = undefined
  tileWorker = undefined
  pending.clear()
}
