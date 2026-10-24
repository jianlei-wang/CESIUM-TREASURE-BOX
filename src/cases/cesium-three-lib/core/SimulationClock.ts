export interface SimulationClockOptions {
  fixedDt?: number
  maxSubSteps?: number
  timeScale?: number
}

export interface ClockAdvance {
  steps: number
  alpha: number
  dropped: number
  backlog: number
  time: number
}

export class SimulationClock {
  readonly fixedDt: number
  readonly maxSubSteps: number
  timeScale: number
  paused = false
  time = 0
  steps = 0
  dropped = 0
  backlog = 0
  private accumulator = 0

  constructor(options: SimulationClockOptions = {}) {
    this.fixedDt = options.fixedDt ?? 1 / 60
    this.maxSubSteps = options.maxSubSteps ?? 8
    this.timeScale = options.timeScale ?? 1
  }

  advance(realDt: number): ClockAdvance {
    if (!Number.isFinite(realDt) || realDt <= 0) {
      return { steps: 0, alpha: this.alpha(), dropped: 0, backlog: this.backlog, time: this.time }
    }
    if (this.paused) {
      return { steps: 0, alpha: this.alpha(), dropped: 0, backlog: this.backlog, time: this.time }
    }
    const scaled = Math.min(realDt * this.timeScale, this.fixedDt * this.maxSubSteps)
    this.accumulator += scaled
    let steps = 0
    while (this.accumulator >= this.fixedDt && steps < this.maxSubSteps) {
      this.accumulator -= this.fixedDt
      this.time += this.fixedDt
      this.steps += 1
      steps += 1
    }
    const dropped = Math.max(0, this.accumulator - this.fixedDt * this.maxSubSteps)
    if (dropped > 0) {
      this.accumulator -= dropped
      this.dropped += dropped
    }
    this.backlog = this.accumulator
    return { steps, alpha: this.alpha(), dropped, backlog: this.backlog, time: this.time }
  }

  stepOnce(): ClockAdvance {
    this.time += this.fixedDt
    this.steps += 1
    return { steps: 1, alpha: this.alpha(), dropped: 0, backlog: this.backlog, time: this.time }
  }

  alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator / this.fixedDt))
  }

  reset(): void {
    this.accumulator = 0
    this.time = 0
    this.steps = 0
    this.dropped = 0
    this.backlog = 0
  }

  serialize(): Record<string, number | boolean> {
    return {
      fixedDt: this.fixedDt,
      timeScale: this.timeScale,
      paused: this.paused,
      time: this.time,
      steps: this.steps,
      dropped: this.dropped,
      backlog: this.backlog
    }
  }
}
