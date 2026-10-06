/**
 * 性能基准：FPS / 帧耗时 / JS 堆 / 各阶段耗时 / 数据指标。
 *
 * 每个旗舰案例通过 `ctx.profiler` 上报 Input / Processed / Visible /
 * Worker / Aggregate / Render / LOD 等指标，由外壳的性能面板统一展示。
 */

export type PerfStats = Record<string, string | number>

export class GeoProfiler {
  private frames = 0
  private framesSinceSample = 0
  private lastSample = 0
  private lastFrame = 0
  private frameMsAccum = 0
  private fpsValue = 0
  private frameMsValue = 0
  private memoryValue = 0
  private stats: PerfStats = {}

  reset(): void {
    this.frames = 0
    this.framesSinceSample = 0
    this.lastSample = 0
    this.lastFrame = 0
    this.frameMsAccum = 0
    this.fpsValue = 0
    this.frameMsValue = 0
    this.stats = {}
  }

  /** 每帧调用；内部每秒采样一次 FPS 与平均帧耗时。 */
  tick(now: number): void {
    this.frames += 1
    this.framesSinceSample += 1
    if (this.lastFrame > 0) this.frameMsAccum += now - this.lastFrame
    this.lastFrame = now

    if (this.lastSample === 0) {
      this.lastSample = now
      return
    }
    const elapsed = now - this.lastSample
    if (elapsed >= 1000) {
      this.fpsValue = Math.round((this.framesSinceSample * 1000) / elapsed)
      this.frameMsValue = this.framesSinceSample > 0 ? this.frameMsAccum / this.framesSinceSample : 0
      this.framesSinceSample = 0
      this.frameMsAccum = 0
      this.lastSample = now
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
      this.memoryValue = memory ? memory.usedJSHeapSize / 1048576 : 0
    }
  }

  get fps(): number {
    return this.fpsValue
  }

  get frameMs(): number {
    return this.frameMsValue
  }

  get memoryMB(): number {
    return this.memoryValue
  }

  /** 设置一个展示指标（会覆盖同名指标）。 */
  set(key: string, value: string | number): void {
    this.stats[key] = value
  }

  merge(stats: PerfStats): void {
    Object.assign(this.stats, stats)
  }

  clearStats(): void {
    this.stats = {}
  }

  snapshot(): PerfStats {
    return { ...this.stats }
  }

  /** 阶段计时：结束时返回耗时（毫秒），并自动上报 `{label}` 指标。 */
  time(label: string): () => number {
    const start = performance.now()
    return () => {
      const duration = performance.now() - start
      this.set(label, `${duration.toFixed(1)} ms`)
      return duration
    }
  }
}
