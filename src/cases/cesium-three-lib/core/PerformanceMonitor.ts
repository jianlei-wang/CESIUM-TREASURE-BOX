export interface RendererStats {
  calls?: number
  triangles?: number
  geometries?: number
  textures?: number
  programs?: number
}

export interface PerformanceSnapshot {
  fps: number
  frameP50: number
  frameP95: number
  physicsP95: number
  longTasks: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  qualityScale: number
  gpuMs: number
  resourceGeometries: number
  resourceMaterials: number
  resourceTextures: number
  backlogMs: number
  droppedSeconds: number
  heapMb: number
}

const MAX_SAMPLES = 180

export class PerformanceMonitor {
  private frames: number[] = []
  private physics: number[] = []
  private longTasks = 0
  private lastFrame = 0
  private observer: PerformanceObserver | null = null
  private qualityScale = 1
  private gpuMs = 0
  private resourceGeometries = 0
  private resourceMaterials = 0
  private resourceTextures = 0
  private backlogMs = 0
  private droppedSeconds = 0
  private renderer: RendererStats = {}

  start(): void {
    if (typeof PerformanceObserver === 'undefined') return
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= 50) this.longTasks += 1
        }
      })
      this.observer.observe({ type: 'longtask', buffered: true })
    } catch {
      this.observer = null
    }
  }

  frame(realDtMs: number, stats?: RendererStats): void {
    if (realDtMs > 0 && realDtMs < 5000) {
      this.frames.push(realDtMs)
      if (this.frames.length > MAX_SAMPLES) this.frames.shift()
    }
    if (stats) this.renderer = stats
  }

  physicsStep(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return
    this.physics.push(ms)
    if (this.physics.length > MAX_SAMPLES) this.physics.shift()
  }

  setQuality(scale: number): void {
    this.qualityScale = scale
  }

  gpuFrame(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) this.gpuMs = ms
  }

  setResources(counts: { geometries: number; materials: number; textures: number }): void {
    this.resourceGeometries = counts.geometries
    this.resourceMaterials = counts.materials
    this.resourceTextures = counts.textures
  }

  setBacklog(milliseconds: number, droppedSeconds: number): void {
    this.backlogMs = milliseconds
    this.droppedSeconds = droppedSeconds
  }

  snapshot(): PerformanceSnapshot {
    const sorted = [...this.frames].sort((a, b) => a - b)
    const physicsSorted = [...this.physics].sort((a, b) => a - b)
    const p = (values: number[], ratio: number): number => {
      if (!values.length) return 0
      return values[Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * ratio)))]
    }
    const p50 = p(sorted, 0.5)
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    return {
      fps: p50 > 0 ? 1000 / p50 : 0,
      frameP50: p50,
      frameP95: p(sorted, 0.95),
      physicsP95: p(physicsSorted, 0.95),
      longTasks: this.longTasks,
      drawCalls: this.renderer.calls ?? 0,
      triangles: this.renderer.triangles ?? 0,
      geometries: this.renderer.geometries ?? 0,
      textures: this.renderer.textures ?? 0,
      qualityScale: this.qualityScale,
      gpuMs: this.gpuMs,
      resourceGeometries: this.resourceGeometries,
      resourceMaterials: this.resourceMaterials,
      resourceTextures: this.resourceTextures,
      backlogMs: this.backlogMs,
      droppedSeconds: this.droppedSeconds,
      heapMb: memory ? memory.usedJSHeapSize / 1048576 : 0
    }
  }

  dispose(): void {
    this.observer?.disconnect()
    this.observer = null
    this.frames = []
    this.physics = []
  }
}
