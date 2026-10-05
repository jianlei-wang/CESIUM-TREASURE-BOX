import * as Cesium from 'cesium'
import type { FieldStats, GridSpec, MonitoringStation, SimulationComputeMode, SimulationParameters, StudyArea } from '@rt/types/model'
import { CesiumEngine } from './cesium-engine'
import { ThreeOverlayEngine, type ThreeFieldRenderOptions } from './three-engine'
import { SimulationWorkerClient } from './simulation-worker-client'
import { GpuRedTideSimulation } from '@rt/simulation/gpu-red-tide-simulation'
import { GpuFlowParticleSimulator } from '@rt/simulation/gpu-flow-particle-simulator'
import { createInitialField8 } from '@rt/simulation/red-tide-simulator'

export class RedTideSystem {
  readonly cesium: CesiumEngine
  readonly three: ThreeOverlayEngine
  readonly simulation: SimulationWorkerClient | null
  readonly gpuSimulation: GpuRedTideSimulation | null
  readonly gpuFlow: GpuFlowParticleSimulator | null
  readonly studyArea: StudyArea
  readonly grid: GridSpec
  readonly params: SimulationParameters
  readonly computeMode: SimulationComputeMode

  private simulationAccumulator = 0
  private pendingOperations = 0
  private isDestroyed = false
  private seekToken = 0
  private _elapsedSeconds = 0
  private _stats: FieldStats = { min: 0, max: 0, mean: 0, affectedAreaKm2: 0, affectedVolumeKm3: 0, affectedDepthM: 0, surfaceMax: 0 }
  private _computeMs = 0

  private constructor(
    cesium: CesiumEngine,
    three: ThreeOverlayEngine,
    studyArea: StudyArea,
    grid: GridSpec,
    params: SimulationParameters,
    options: {
      simulation: SimulationWorkerClient | null
      gpuSimulation: GpuRedTideSimulation | null
      gpuFlow: GpuFlowParticleSimulator | null
      computeMode: SimulationComputeMode
      elapsedSeconds: number
      stats: FieldStats
      computeMs: number
    },
  ) {
    this.cesium = cesium
    this.three = three
    this.simulation = options.simulation
    this.gpuSimulation = options.gpuSimulation
    this.gpuFlow = options.gpuFlow
    this.computeMode = options.computeMode
    this.studyArea = studyArea
    this.grid = grid
    this.params = params
    this._elapsedSeconds = options.elapsedSeconds
    this._stats = options.stats
    this._computeMs = options.computeMs

    this.cesium.addStudyAreaOverlay()
    this.cesium.viewer.scene.postRender.addEventListener(this.afterCesiumRender)
    this.three.updateTime(this._elapsedSeconds)
    this.three.updateCamera(this.cesium.spatial, this.cesium.viewer.camera)
    this.three.warmup()
  }

  static async create(
    cesiumContainer: HTMLElement,
    studyArea: StudyArea,
    grid: GridSpec,
    params: SimulationParameters,
    renderOptions: ThreeFieldRenderOptions,
  ): Promise<RedTideSystem> {
    const cesium = new CesiumEngine(cesiumContainer, studyArea)
    try {
      const initialField8 = createInitialField8(grid)
      const placeholderSurface = new Uint8Array(128 * 128)
      const placeholderParticles = new Float32Array(5200 * 3)
      const placeholderIntensities = new Float32Array(5200)
      const three = new ThreeOverlayEngine(
        cesium,
        grid,
        initialField8,
        placeholderSurface,
        placeholderParticles,
        placeholderIntensities,
        cesium.spatial,
        renderOptions,
      )

      if (three.supportsGpgpu) {
        let gpuSimulation: GpuRedTideSimulation | null = null
        try {
          gpuSimulation = new GpuRedTideSimulation(three.renderer, grid, params, initialField8)
          const gpuFlow = three.enableGpuFlow()
          three.bindGpuField(gpuSimulation.texture, grid.nx, grid.ny, grid.nz)
          const stats = await gpuSimulation.statsAsync(true)
          return new RedTideSystem(cesium, three, studyArea, grid, params, {
            simulation: null,
            gpuSimulation,
            gpuFlow,
            computeMode: 'gpu-gpgpu',
            elapsedSeconds: gpuSimulation.elapsed,
            stats,
            computeMs: 0,
          })
        } catch (error) {
          console.warn('[RedTide] GPU GPGPU initialization failed; fallback to Worker.', error)
          gpuSimulation?.dispose()
          three.useCpuFlow()
          three.volume.useCpuTexture()
        }
      }

      const simulation = await SimulationWorkerClient.create(grid, params)
      const system = new RedTideSystem(cesium, three, studyArea, grid, params, {
        simulation,
        gpuSimulation: null,
        gpuFlow: null,
        computeMode: simulation.mode,
        elapsedSeconds: simulation.elapsedSeconds,
        stats: simulation.stats,
        computeMs: simulation.computeMs,
      })
      system.three.updateField(simulation.field8, simulation.surface8, simulation.particles, simulation.particleIntensities, simulation.elapsedSeconds)
      return system
    } catch (error) {
      cesium.destroy()
      throw error
    }
  }

  get elapsedSeconds(): number { return this._elapsedSeconds }
  get stats() { return this._stats }
  get computeMs(): number { return this._computeMs }

  tick(realSeconds: number, simulationSpeed: number): void {
    if (this.isDestroyed) return
    const multiplier = Math.max(simulationSpeed, 0)
    if (multiplier <= 0) return
    this.simulationAccumulator += realSeconds * multiplier
    if (this.pendingOperations > 0) return

    const steps = Math.min(this.params.maxStepsPerFrame ?? 24, Math.floor(this.simulationAccumulator / this.params.dtSeconds))
    if (steps <= 0) return
    this.simulationAccumulator -= steps * this.params.dtSeconds

    if (this.computeMode === 'gpu-gpgpu' && this.gpuSimulation && this.gpuFlow) {
      const startedAt = performance.now()
      for (let i = 0; i < steps; i += 1) {
        const before = this.gpuSimulation.elapsed
        this.gpuSimulation.step()
        this.gpuFlow.step(before, this.params.dtSeconds)
      }
      this._computeMs = (performance.now() - startedAt) / steps
      this._elapsedSeconds = this.gpuSimulation.elapsed
      // Ping-pong 后 front target 已发生切换，必须重新绑定当前 GPU field texture；
      // 否则 Volume / Surface / Particle 会一直采样旧的 target。
      this.three.bindGpuField(this.gpuSimulation.texture, this.grid.nx, this.grid.ny, this.grid.nz)
      void this.gpuSimulation.statsAsync().then((stats) => {
        if (!this.isDestroyed) this._stats = stats
      })
      this.three.updateTime(this._elapsedSeconds)
      this.requestRender()
      return
    }

    if (!this.simulation) return
    this.pendingOperations += 1
    void this.simulation.advanceSteps(steps)
      .then((frame) => {
        if (this.isDestroyed) return
        this._elapsedSeconds = frame.elapsedSeconds
        this._stats = frame.stats
        this._computeMs = frame.computeMs
        this.three.updateField(frame.field8, frame.surface8, frame.particles, frame.particleIntensities, frame.elapsedSeconds)
        this.requestRender()
      })
      .catch((error) => console.error(error))
      .finally(() => { this.pendingOperations -= 1 })
  }

  async reset(): Promise<void> {
    if (this.isDestroyed) return
    this.seekToken += 1
    this.simulationAccumulator = 0
    if (this.computeMode === 'gpu-gpgpu' && this.gpuSimulation && this.gpuFlow) {
      this.gpuSimulation.reset()
      this.gpuFlow.reset()
      this._elapsedSeconds = 0
      this._stats = await this.gpuSimulation.statsAsync(true)
      this._computeMs = 0
      this.three.bindGpuField(this.gpuSimulation.texture, this.grid.nx, this.grid.ny, this.grid.nz)
      this.three.updateTime(0)
      this.requestRender()
      return
    }
    if (!this.simulation) return
    this.pendingOperations += 1
    try {
      const frame = await this.simulation.reset()
      this._elapsedSeconds = frame.elapsedSeconds
      this._stats = frame.stats
      this._computeMs = frame.computeMs
      this.three.updateField(frame.field8, frame.surface8, frame.particles, frame.particleIntensities, frame.elapsedSeconds)
      this.requestRender()
    } finally {
      this.pendingOperations -= 1
    }
  }

  async seekTo(secondsFromStart: number): Promise<void> {
    if (this.isDestroyed) return
    const target = Math.max(0, secondsFromStart)
    const token = ++this.seekToken
    this.simulationAccumulator = 0

    if (this.computeMode === 'gpu-gpgpu' && this.gpuSimulation && this.gpuFlow) {
      const restored = this.gpuSimulation.restoreNearestSnapshot(target)
      this.gpuFlow.reset()
      const steps = Math.min(Math.floor((target - restored) / this.params.dtSeconds), 384)
      const startedAt = performance.now()
      for (let i = 0; i < steps; i += 1) {
        if (token !== this.seekToken) return
        const before = this.gpuSimulation.elapsed
        this.gpuSimulation.step()
        this.gpuFlow.step(before, this.params.dtSeconds)
        if (i > 0 && i % 16 === 0) await yieldToBrowser()
      }
      if (token !== this.seekToken) return
      this._elapsedSeconds = this.gpuSimulation.elapsed
      this._stats = await this.gpuSimulation.statsAsync(true)
      this._computeMs = (performance.now() - startedAt) / Math.max(steps, 1)
      this.three.bindGpuField(this.gpuSimulation.texture, this.grid.nx, this.grid.ny, this.grid.nz)
      this.three.updateTime(this._elapsedSeconds)
      this.requestRender()
      return
    }

    if (!this.simulation) return
    this.pendingOperations += 1
    try {
      const frame = await this.simulation.seek(target)
      if (token !== this.seekToken) return
      this._elapsedSeconds = frame.elapsedSeconds
      this._stats = frame.stats
      this._computeMs = frame.computeMs
      this.three.updateField(frame.field8, frame.surface8, frame.particles, frame.particleIntensities, frame.elapsedSeconds)
      this.requestRender()
    } finally {
      this.pendingOperations -= 1
    }
  }

  setSimulationParameters(params: Partial<SimulationParameters>): void {
    Object.assign(this.params, params)
    if (this.gpuSimulation) this.gpuSimulation.setParameters(params)
    this.simulation?.updateParameters(params)
    this.requestRender()
  }

  setRenderOptions(options: ThreeFieldRenderOptions): void { this.three.applyOptions(options) }
  requestRender(): void { this.cesium.viewer.scene.requestRender() }

  setStations(stations: MonitoringStation[], onSelect: (station: MonitoringStation) => void): void {
    this.cesium.addStations(stations, onSelect)
  }

  destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.cesium.viewer.scene.postRender.removeEventListener(this.afterCesiumRender)
    this.simulation?.dispose()
    this.gpuSimulation?.dispose()
    this.three.dispose()
    this.cesium.destroy()
  }

  private readonly afterCesiumRender = (): void => {
    if (this.isDestroyed) return
    this.three.updateCamera(this.cesium.spatial, this.cesium.viewer.camera)
    this.three.renderAfterCesium()
  }
}

async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
