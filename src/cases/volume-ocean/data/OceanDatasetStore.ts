/**
 * 数据集状态仓库
 *
 * 负责区域数据块的加载、按月缓存与版本切换，向 UI 暴露状态与采样器。
 * 区域切换会提升 generation 并中止旧请求，避免旧数据回填。
 */

import { loadFrame, loadManifest, loadStatic } from './OceanDatasetLoader'
import type { OceanDatasetStatic, OceanFrameData } from './OceanDatasetLoader'
import { OceanGridSampler } from './OceanGridSampler'
import type { OceanDatasetManifest, OceanRegionPreset } from '../ocean-tsd.types'

export type OceanStoreStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface OceanStoreSnapshot {
  status: OceanStoreStatus
  error: string | null
  timeIndex: number
  regionId: string
  progress: string
}

export type OceanStoreListener = (snapshot: OceanStoreSnapshot) => void

export class OceanDatasetStore {
  manifest: OceanDatasetManifest | null = null
  private staticData: OceanDatasetStatic | null = null
  private samplerRef: OceanGridSampler | null = null
  private frames = new Map<number, OceanFrameData>()
  private inflight = new Map<number, Promise<OceanFrameData>>()
  private generation = 0
  private abort: AbortController | null = null
  private region: OceanRegionPreset
  status: OceanStoreStatus = 'idle'
  error: string | null = null
  timeIndex = 0
  private progress = ''

  constructor(
    region: OceanRegionPreset,
    private readonly listener: OceanStoreListener
  ) {
    this.region = region
  }

  get regionId(): string {
    return this.region.id
  }

  get timeCount(): number {
    return this.manifest?.timeLabels.length ?? 0
  }

  private emit(): void {
    this.listener({
      status: this.status,
      error: this.error,
      timeIndex: this.timeIndex,
      regionId: this.region.id,
      progress: this.progress
    })
  }

  sampler(): OceanGridSampler | null {
    return this.samplerRef
  }

  /** 加载区域清单与静态体，并载入首月数据块 */
  async loadRegion(region: OceanRegionPreset): Promise<void> {
    this.generation += 1
    const generation = this.generation
    this.abort?.abort()
    this.abort = new AbortController()
    const signal = this.abort.signal

    this.region = region
    this.manifest = null
    this.staticData = null
    this.samplerRef = null
    this.frames.clear()
    this.inflight.clear()
    this.status = 'loading'
    this.error = null
    this.progress = '加载清单…'
    this.emit()

    try {
      const manifest = await loadManifest(region.dataDir, signal)
      if (generation !== this.generation) return
      this.progress = '加载坐标与地形…'
      this.emit()
      const staticData = await loadStatic(region.dataDir, manifest, signal)
      if (generation !== this.generation) return
      this.manifest = manifest
      this.staticData = staticData
      this.samplerRef = new OceanGridSampler(staticData, this.emptyFrame())

      await this.loadTimeFrame(this.clampTime(this.timeIndex), generation)
      if (generation !== this.generation) return
      this.status = 'ready'
      this.progress = ''
      this.emit()
    } catch (error) {
      if (signal.aborted || generation !== this.generation) return
      this.status = 'error'
      this.error = error instanceof Error ? error.message : String(error)
      this.progress = ''
      this.emit()
    }
  }

  private emptyFrame(): OceanFrameData {
    const { nx, ny, nz } = this.staticData!.manifest.grid
    const planar = nx * ny * nz
    const nan = () => {
      const arr = new Float32Array(planar)
      arr.fill(NaN)
      return arr
    }
    return { timeIndex: 0, values: { temperature: nan(), salinity: nan(), u: nan(), v: nan() } }
  }

  private clampTime(index: number): number {
    const count = this.timeCount
    if (count === 0) return 0
    return Math.max(0, Math.min(index, count - 1)) % count
  }

  private async loadTimeFrame(index: number, generation: number): Promise<OceanFrameData> {
    const cached = this.frames.get(index)
    if (cached) {
      if (this.samplerRef) this.samplerRef.frame = cached
      this.timeIndex = index
      return cached
    }
    const existing = this.inflight.get(index)
    if (existing) {
      const frame = await existing
      if (generation === this.generation && this.samplerRef) this.samplerRef.frame = frame
      return frame
    }
    const manifest = this.manifest!
    const dataDir = this.region.dataDir
    const mask = this.staticData!.mask
    const signal = this.abort?.signal
    const promise = loadFrame(dataDir, manifest, mask, index, signal)
    this.inflight.set(index, promise)
    try {
      const frame = await promise
      if (generation === this.generation) {
        this.frames.set(index, frame)
      }
      return frame
    } finally {
      this.inflight.delete(index)
    }
  }

  /** 切换时间（月份），返回是否成功 */
  async setTime(index: number): Promise<void> {
    if (!this.manifest || !this.staticData) return
    const generation = this.generation
    const target = this.clampTime(index)
    this.progress = '加载数据块…'
    this.status = 'loading'
    this.emit()
    try {
      const frame = await this.loadTimeFrame(target, generation)
      if (generation !== this.generation) return
      if (this.samplerRef) this.samplerRef.frame = frame
      this.timeIndex = target
      this.status = 'ready'
      this.progress = ''
      this.emit()
    } catch (error) {
      if (generation !== this.generation) return
      this.status = 'error'
      this.error = error instanceof Error ? error.message : String(error)
      this.progress = ''
      this.emit()
    }
  }

  dispose(): void {
    this.generation += 1
    this.abort?.abort()
    this.abort = null
    this.frames.clear()
    this.inflight.clear()
    this.samplerRef = null
    this.staticData = null
    this.manifest = null
  }
}
