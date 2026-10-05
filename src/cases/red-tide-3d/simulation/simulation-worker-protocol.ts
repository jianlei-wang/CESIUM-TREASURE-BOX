import type { FieldStats, GridSpec, SimulationFrame, SimulationParameters } from '@rt/types/model'

export interface SimulationInitMessage {
  type: 'init'
  grid: GridSpec
  params: SimulationParameters
  useSharedBuffers: boolean
  buffers?: {
    field8: SharedArrayBuffer
    surface8: SharedArrayBuffer
    particles: SharedArrayBuffer
    particleIntensities: SharedArrayBuffer
    control: SharedArrayBuffer
  }
}

export interface SimulationAdvanceMessage {
  type: 'advance'
  steps: number
}

export interface SimulationUpdateParametersMessage {
  type: 'update-params'
  params: Partial<SimulationParameters>
}

export interface SimulationSeekMessage {
  type: 'seek'
  seconds: number
}

export interface SimulationResetMessage {
  type: 'reset'
}

export interface SimulationDisposeMessage {
  type: 'dispose'
}

export type SimulationWorkerMessage =
  | SimulationInitMessage
  | SimulationAdvanceMessage
  | SimulationUpdateParametersMessage
  | SimulationSeekMessage
  | SimulationResetMessage
  | SimulationDisposeMessage

export interface SimulationReadyMessage {
  type: 'ready'
  mode: 'shared-array-buffer' | 'transferable'
  frame: TransferableSimulationFrame
}

export interface SimulationFrameMessage {
  type: 'frame'
  mode: 'shared-array-buffer' | 'transferable'
  frame: TransferableSimulationFrame
}

export interface SimulationErrorMessage {
  type: 'error'
  message: string
}

export type SimulationWorkerResponse = SimulationReadyMessage | SimulationFrameMessage | SimulationErrorMessage

export interface TransferableSimulationFrame {
  elapsedSeconds: number
  stats: FieldStats
  computeMs: number
  steps: number
  version: number
  field8?: ArrayBuffer
  surface8?: ArrayBuffer
  particles?: ArrayBuffer
  particleIntensities?: ArrayBuffer
}

export function materializeTransferableFrame(
  frame: TransferableSimulationFrame,
  sharedViews?: {
    field8: Uint8Array
    surface8: Uint8Array
    particles: Float32Array
    particleIntensities: Float32Array
  },
): SimulationFrame {
  if (sharedViews) {
    return {
      ...frame,
      field8: sharedViews.field8,
      surface8: sharedViews.surface8,
      particles: sharedViews.particles,
      particleIntensities: sharedViews.particleIntensities,
    }
  }

  return {
    ...frame,
    field8: new Uint8Array(frame.field8 ?? new ArrayBuffer(0)),
    surface8: new Uint8Array(frame.surface8 ?? new ArrayBuffer(0)),
    particles: new Float32Array(frame.particles ?? new ArrayBuffer(0)),
    particleIntensities: new Float32Array(frame.particleIntensities ?? new ArrayBuffer(0)),
  }
}