import type { FieldStats, GridSpec, SimulationFrame, SimulationParameters, SimulationComputeMode } from '@rt/types/model'
import {
  materializeTransferableFrame,
  type SimulationWorkerMessage,
  type SimulationWorkerResponse,
  type TransferableSimulationFrame,
} from '@rt/simulation/simulation-worker-protocol'

export class SimulationWorkerClient {
  readonly mode: SimulationComputeMode
  readonly field8: Uint8Array
  readonly surface8: Uint8Array
  readonly particles: Float32Array
  readonly particleIntensities: Float32Array

  private readonly worker: Worker
  private disposed = false
  private pendingResolvers: Array<(frame: SimulationFrame) => void> = []
  private pendingRejectors: Array<(reason?: unknown) => void> = []
  private lastFrame: SimulationFrame | null = null
  private readonly sharedControl?: Int32Array

  private constructor(
    worker: Worker,
    mode: SimulationComputeMode,
    field8: Uint8Array,
    surface8: Uint8Array,
    particles: Float32Array,
    particleIntensities: Float32Array,
    sharedControl?: Int32Array,
  ) {
    this.worker = worker
    this.mode = mode
    this.field8 = field8
    this.surface8 = surface8
    this.particles = particles
    this.particleIntensities = particleIntensities
    this.sharedControl = sharedControl
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleError)
  }

  static async create(grid: GridSpec, params: SimulationParameters): Promise<SimulationWorkerClient> {
    const worker = new Worker(new URL('../simulation/simulation.worker.ts', import.meta.url), { type: 'module' })
    const useSharedBuffers = typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated === true
    const fieldSize = grid.nx * grid.ny * grid.nz
    const particleCount = 5200

    const fieldBuffer = useSharedBuffers ? new SharedArrayBuffer(fieldSize) : undefined
    const surfaceBuffer = useSharedBuffers ? new SharedArrayBuffer(128 * 128) : undefined
    const particlesBuffer = useSharedBuffers ? new SharedArrayBuffer(particleCount * 3 * 4) : undefined
    const intensitiesBuffer = useSharedBuffers ? new SharedArrayBuffer(particleCount * 4) : undefined
    const controlBuffer = useSharedBuffers ? new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4) : undefined

    const field8 = fieldBuffer ? new Uint8Array(fieldBuffer) : new Uint8Array(fieldSize)
    const surface8 = surfaceBuffer ? new Uint8Array(surfaceBuffer) : new Uint8Array(128 * 128)
    const particles = particlesBuffer ? new Float32Array(particlesBuffer) : new Float32Array(particleCount * 3)
    const particleIntensities = intensitiesBuffer ? new Float32Array(intensitiesBuffer) : new Float32Array(particleCount)
    const control = controlBuffer ? new Int32Array(controlBuffer) : undefined

    const client = new SimulationWorkerClient(
      worker,
      useSharedBuffers ? 'shared-array-buffer' : 'transferable',
      field8,
      surface8,
      particles,
      particleIntensities,
      control,
    )

    await client.init(grid, params, fieldBuffer, surfaceBuffer, particlesBuffer, intensitiesBuffer, controlBuffer)
    return client
  }

  get elapsedSeconds(): number {
    return this.lastFrame?.elapsedSeconds ?? 0
  }

  get stats(): FieldStats {
    return this.lastFrame?.stats ?? { min: 0, max: 0, mean: 0, affectedAreaKm2: 0, affectedVolumeKm3: 0, affectedDepthM: 0, surfaceMax: 0 }
  }

  get computeMs(): number {
    return this.lastFrame?.computeMs ?? 0
  }

  advanceSteps(steps: number): Promise<SimulationFrame> {
    return this.send({ type: 'advance', steps })
  }

  updateParameters(params: Partial<SimulationParameters>): void {
    if (this.disposed) return
    this.worker.postMessage({ type: 'update-params', params })
  }

  reset(): Promise<SimulationFrame> {
    return this.send({ type: 'reset' })
  }

  seek(seconds: number): Promise<SimulationFrame> {
    return this.send({ type: 'seek', seconds })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleError)
    this.worker.postMessage({ type: 'dispose' } satisfies SimulationWorkerMessage)
    this.worker.terminate()
    this.pendingRejectors.splice(0).forEach((reject) => reject(new Error('Simulation worker disposed.')))
    this.pendingResolvers.length = 0
  }

  private async init(
    grid: GridSpec,
    params: SimulationParameters,
    fieldBuffer?: SharedArrayBuffer,
    surfaceBuffer?: SharedArrayBuffer,
    particlesBuffer?: SharedArrayBuffer,
    intensitiesBuffer?: SharedArrayBuffer,
    controlBuffer?: SharedArrayBuffer,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (event: ErrorEvent) => {
        this.worker.removeEventListener('message', onReady as EventListener)
        this.worker.removeEventListener('error', onError)
        reject(new Error(event.message || 'Simulation worker initialization failed.'))
      }
      const onReady = (event: MessageEvent<SimulationWorkerResponse>) => {
        if (event.data.type === 'error') {
          this.worker.removeEventListener('message', onReady as EventListener)
          this.worker.removeEventListener('error', onError)
          reject(new Error(event.data.message))
          return
        }
        if (event.data.type !== 'ready') return
        this.worker.removeEventListener('message', onReady as EventListener)
        this.worker.removeEventListener('error', onError)
        this.consume(event.data.frame)
        resolve()
      }
      this.worker.addEventListener('message', onReady as EventListener)
      this.worker.addEventListener('error', onError)
      const message: SimulationWorkerMessage = {
        type: 'init',
        grid,
        params,
        useSharedBuffers: this.mode === 'shared-array-buffer',
        buffers: fieldBuffer && surfaceBuffer && particlesBuffer && intensitiesBuffer && controlBuffer
          ? {
              field8: fieldBuffer,
              surface8: surfaceBuffer,
              particles: particlesBuffer,
              particleIntensities: intensitiesBuffer,
              control: controlBuffer,
            }
          : undefined,
      }
      this.worker.postMessage(message)
    })
  }

  private send(message: SimulationWorkerMessage): Promise<SimulationFrame> {
    if (this.disposed) return Promise.reject(new Error('Simulation worker disposed.'))
    return new Promise<SimulationFrame>((resolve, reject) => {
      this.pendingResolvers.push(resolve)
      this.pendingRejectors.push(reject)
      this.worker.postMessage(message)
    })
  }

  private readonly handleMessage = (event: MessageEvent<SimulationWorkerResponse>): void => {
    const response = event.data
    if (response.type === 'error') {
      const reject = this.pendingRejectors.shift()
      this.pendingResolvers.shift()
      reject?.(new Error(response.message))
      return
    }
    if (response.type !== 'frame') return
    const frame = this.consume(response.frame)
    const resolve = this.pendingResolvers.shift()
    this.pendingRejectors.shift()
    resolve?.(frame)
  }

  private readonly handleError = (event: ErrorEvent): void => {
    const error = new Error(event.message || 'Simulation worker error.')
    this.pendingRejectors.splice(0).forEach((reject) => reject(error))
    this.pendingResolvers.length = 0
  }

  private consume(frame: TransferableSimulationFrame): SimulationFrame {
    if (this.mode === 'shared-array-buffer') {
      this.lastFrame = materializeTransferableFrame(frame, {
        field8: this.field8,
        surface8: this.surface8,
        particles: this.particles,
        particleIntensities: this.particleIntensities,
      })
    } else {
      const materialized = materializeTransferableFrame(frame)
      this.field8.set(materialized.field8)
      this.surface8.set(materialized.surface8)
      this.particles.set(materialized.particles)
      this.particleIntensities.set(materialized.particleIntensities)
      this.lastFrame = {
        ...materialized,
        field8: this.field8,
        surface8: this.surface8,
        particles: this.particles,
        particleIntensities: this.particleIntensities,
      }
    }

    return this.lastFrame
  }
}