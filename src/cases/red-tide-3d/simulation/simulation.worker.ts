import { RedTideSimulator } from './red-tide-simulator'
import { FlowParticleSimulator } from './flow-particle-simulator'
import type { SimulationFrameMessage, SimulationInitMessage, SimulationWorkerMessage, TransferableSimulationFrame } from './simulation-worker-protocol'
import type { GridSpec, SimulationParameters } from '@rt/types/model'

interface WorkerScope {
  onmessage: ((event: MessageEvent<SimulationWorkerMessage>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
  close(): void
}

const workerScope = self as unknown as WorkerScope

let simulator: RedTideSimulator | null = null
let particles: FlowParticleSimulator | null = null
let grid: GridSpec | null = null
let mode: 'shared-array-buffer' | 'transferable' = 'transferable'
let field8: Uint8Array | null = null
let surface8: Uint8Array | null = null
let particlePositions: Float32Array | null = null
let particleIntensities: Float32Array | null = null
let control: Int32Array | null = null
let version = 0

function createSharedViews(message: SimulationInitMessage): void {
  const buffers = message.buffers
  if (!buffers || !grid) throw new Error('SharedArrayBuffer buffers are missing.')
  field8 = new Uint8Array(buffers.field8)
  surface8 = new Uint8Array(buffers.surface8)
  particlePositions = new Float32Array(buffers.particles)
  particleIntensities = new Float32Array(buffers.particleIntensities)
  control = new Int32Array(buffers.control)
}

function createTransferableViews(): void {
  const currentGrid = grid
  if (!currentGrid) throw new Error('Grid is not initialized.')
  const fieldSize = currentGrid.nx * currentGrid.ny * currentGrid.nz
  field8 = new Uint8Array(fieldSize)
  surface8 = new Uint8Array(128 * 128)
  particlePositions = new Float32Array(5200 * 3)
  particleIntensities = new Float32Array(5200)
}

function writeFrame(steps: number, startedAt = performance.now()): TransferableSimulationFrame {
  const currentSimulator = simulator
  const currentGrid = grid
  if (!currentSimulator || !currentGrid || !particles || !field8 || !surface8 || !particlePositions || !particleIntensities) {
    throw new Error('Simulation engine is not initialized.')
  }

  currentSimulator.quantizeFieldInto(field8)
  currentSimulator.sampleSurfaceInto(surface8, 128, 128)
  particles.update(
    currentSimulator.elapsed,
    field8,
    currentSimulator.params.dtSeconds * Math.max(steps, 0),
  )
  particles.writeTo(particlePositions, particleIntensities)
  const totalComputeMs = performance.now() - startedAt
  const computeMs = totalComputeMs / Math.max(steps, 1)
  version += 1

  const stats = currentSimulator.stats()
  const frame: TransferableSimulationFrame = {
    elapsedSeconds: currentSimulator.elapsed,
    stats,
    computeMs,
    steps,
    version,
  }

  if (mode === 'shared-array-buffer') {
    if (control) {
      Atomics.store(control, 0, version)
      Atomics.store(control, 1, Math.round(totalComputeMs * 1000))
      Atomics.notify(control, 0)
    }
    return frame
  }

  const transferField = field8.buffer as ArrayBuffer
  const transferSurface = surface8.buffer as ArrayBuffer
  const transferParticles = particlePositions.buffer as ArrayBuffer
  const transferIntensities = particleIntensities.buffer as ArrayBuffer

  frame.field8 = transferField
  frame.surface8 = transferSurface
  frame.particles = transferParticles
  frame.particleIntensities = transferIntensities

  field8 = new Uint8Array(currentGrid.nx * currentGrid.ny * currentGrid.nz)
  surface8 = new Uint8Array(128 * 128)
  particlePositions = new Float32Array(5200 * 3)
  particleIntensities = new Float32Array(5200)

  return frame
}

function initialize(message: SimulationInitMessage): void {
  grid = message.grid
  const seedData = new Float32Array(grid.nx * grid.ny * grid.nz)
  const scratch = new Float32Array(grid.nx * grid.ny * grid.nz)
  simulator = new RedTideSimulator(grid, message.params, seedData, scratch)
  particles = new FlowParticleSimulator(grid)

  mode = message.useSharedBuffers && typeof SharedArrayBuffer !== 'undefined'
    ? 'shared-array-buffer'
    : 'transferable'

  if (mode === 'shared-array-buffer') createSharedViews(message)
  else createTransferableViews()
}

function handle(message: SimulationWorkerMessage): void {
  try {
    if (message.type === 'init') {
      initialize(message)
      const frame = writeFrame(0)
      workerScope.postMessage({
        type: 'ready',
        mode,
        frame,
      } satisfies { type: 'ready'; mode: typeof mode; frame: TransferableSimulationFrame }, getTransferList(frame))
      return
    }

    if (message.type === 'update-params') {
      if (!simulator) throw new Error('Simulation engine is not initialized.')
      Object.assign(simulator.params, message.params)
      return
    }

    if (message.type === 'advance') {
      if (!simulator) throw new Error('Simulation engine is not initialized.')
      const steps = Math.max(0, Math.min(240, Math.floor(message.steps)))
      const startedAt = performance.now()
      for (let i = 0; i < steps; i += 1) simulator.step()
      const frame = writeFrame(steps, startedAt)
      workerScope.postMessage({ type: 'frame', mode, frame } satisfies SimulationFrameMessage, getTransferList(frame))
      return
    }

    if (message.type === 'reset') {
      if (!simulator || !particles) throw new Error('Simulation engine is not initialized.')
      const startedAt = performance.now()
      simulator.reset()
      particles.reset()
      const frame = writeFrame(0, startedAt)
      workerScope.postMessage({ type: 'frame', mode, frame } satisfies SimulationFrameMessage, getTransferList(frame))
      return
    }

    if (message.type === 'seek') {
      if (!simulator || !particles) throw new Error('Simulation engine is not initialized.')
      const startedAt = performance.now()
      simulator.restoreNearestSnapshot(message.seconds)
      const remaining = Math.max(0, message.seconds - simulator.elapsed)
      const steps = Math.min(240, Math.floor(remaining / simulator.params.dtSeconds))
      for (let i = 0; i < steps; i += 1) simulator.step()
      particles.reset()
      const frame = writeFrame(steps, startedAt)
      workerScope.postMessage({ type: 'frame', mode, frame } satisfies SimulationFrameMessage, getTransferList(frame))
      return
    }

    if (message.type === 'dispose') {
      simulator = null
      particles = null
      grid = null
      field8 = null
      surface8 = null
      particlePositions = null
      particleIntensities = null
      control = null
      workerScope.close()
    }
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Simulation worker failed.',
    })
  }
}

function getTransferList(frame: TransferableSimulationFrame): Transferable[] {
  if (mode === 'shared-array-buffer') return []
  return [
    frame.field8!,
    frame.surface8!,
    frame.particles!,
    frame.particleIntensities!,
  ]
}

workerScope.onmessage = (event) => handle(event.data)