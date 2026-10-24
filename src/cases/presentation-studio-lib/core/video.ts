import { drawFittedSource, type OutputFit } from './export-profile'

const FORMAT_CANDIDATES = [
  { mime: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
  { mime: 'video/mp4;codecs=avc1', extension: 'mp4' },
  { mime: 'video/mp4', extension: 'mp4' },
  { mime: 'video/webm;codecs=vp9', extension: 'webm' },
  { mime: 'video/webm;codecs=vp8', extension: 'webm' },
  { mime: 'video/webm', extension: 'webm' }
]

export interface RecorderFormat {
  mime: string
  extension: string
  label: string
}

export type RecorderPhase = 'idle' | 'recording' | 'stopping' | 'completed' | 'failed' | 'cancelled'

export class RecorderError extends Error {
  readonly cause: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'RecorderError'
    this.cause = cause
  }
}

export function detectRecorderFormat(): RecorderFormat | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const candidate of FORMAT_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate.mime)) {
      return {
        ...candidate,
        label: candidate.extension === 'mp4' ? 'MP4 / H.264' : 'WebM'
      }
    }
  }
  return null
}

export function bitrateFor(width: number, height: number, fps: number): number {
  return Math.round(Math.min(60_000_000, Math.max(6_000_000, width * height * fps * 0.085)))
}

export interface CompositeExporterOptions {
  source: HTMLCanvasElement
  width: number
  height: number
  fps: number
  mime: string
  fit?: OutputFit
  background?: string
  /** 0 表示手动 requestFrame，用于确定性逐帧提交。 */
  captureFps?: number
  stopTimeoutMs?: number
}

export class CompositeExporter {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly recorder: MediaRecorder
  private readonly track: MediaStreamTrack | null
  private readonly stream: MediaStream
  private readonly chunks: Blob[] = []
  private readonly options: CompositeExporterOptions
  private phase: RecorderPhase = 'idle'
  private failure: RecorderError | null = null
  private stopPromise: Promise<Blob> | null = null
  private readonly stopTimeoutMs: number
  private frameCount = 0

  constructor(options: CompositeExporterOptions) {
    this.options = options
    this.stopTimeoutMs = options.stopTimeoutMs ?? 20_000
    this.canvas = document.createElement('canvas')
    this.canvas.width = options.width
    this.canvas.height = options.height
    const context = this.canvas.getContext('2d', { alpha: false })
    if (!context) throw new RecorderError('无法创建视频合成画布')
    this.ctx = context
    this.ctx.imageSmoothingEnabled = true
    this.ctx.imageSmoothingQuality = 'high'
    this.ctx.fillStyle = options.background ?? '#040a12'
    this.ctx.fillRect(0, 0, options.width, options.height)
    this.stream = this.canvas.captureStream(options.captureFps ?? options.fps)
    this.track = this.stream.getVideoTracks()[0] ?? null
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: options.mime,
      videoBitsPerSecond: bitrateFor(options.width, options.height, options.fps)
    })
    this.recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    })
    this.recorder.addEventListener('error', (event) => {
      const error = (event as unknown as { error?: DOMException }).error
      this.fail(new RecorderError(`视频编码器错误${error?.message ? `：${error.message}` : ''}`, error))
    })
    this.recorder.start(220)
    this.phase = 'recording'
  }

  get state(): RecorderPhase {
    return this.phase
  }

  get frames(): number {
    return this.frameCount
  }

  get wasCancelled(): boolean {
    return this.phase === 'cancelled'
  }

  get failureReason(): RecorderError | null {
    return this.failure
  }

  drawFrame(overlay: (ctx: CanvasRenderingContext2D, width: number, height: number) => void, source?: HTMLCanvasElement): void {
    if (this.phase !== 'recording') return
    const { width, height, fit, background } = this.options
    const image = source ?? this.options.source
    drawFittedSource(
      this.ctx,
      image,
      image.width,
      image.height,
      width,
      height,
      fit ?? 'contain',
      background ?? '#040a12'
    )
    overlay(this.ctx, width, height)
    this.frameCount += 1
    if (this.options.captureFps === 0 && this.track && 'requestFrame' in this.track && typeof this.track.requestFrame === 'function') {
      ;(this.track as CanvasCaptureMediaStreamTrack).requestFrame()
    }
  }

  private fail(error: RecorderError): void {
    if (this.phase === 'completed' || this.phase === 'failed' || this.phase === 'cancelled') return
    this.failure = error
    this.phase = 'failed'
    this.cleanupTracks()
    if (this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop()
      } catch {
        /* 已经停止 */
      }
    }
  }

  private cleanupTracks(): void {
    this.stream.getTracks().forEach((track) => {
      try {
        track.stop()
      } catch {
        /* 已停止 */
      }
    })
  }

  async stop(): Promise<Blob> {
    if (this.stopPromise) return this.stopPromise
    this.phase = 'stopping'
    this.stopPromise = new Promise<Blob>((resolve, reject) => {
      const recorder = this.recorder
      const finish = (): void => {
        if (this.phase === 'cancelled') {
          reject(new RecorderError('导出已取消'))
          return
        }
        if (this.failure) {
          reject(this.failure)
          return
        }
        this.phase = 'completed'
        const blob = new Blob(this.chunks, { type: this.options.mime })
        if (!blob.size) {
          reject(new RecorderError('录制结果为空'))
          return
        }
        resolve(blob)
      }
      let timeout = 0
      const onStop = (): void => {
        window.clearTimeout(timeout)
        cleanup()
        finish()
      }
      const onError = (): void => {
        window.clearTimeout(timeout)
        cleanup()
        reject(this.failure ?? new RecorderError('视频编码器错误'))
      }
      const cleanup = (): void => {
        recorder.removeEventListener('stop', onStop)
        recorder.removeEventListener('error', onError)
        this.cleanupTracks()
      }
      recorder.addEventListener('stop', onStop)
      recorder.addEventListener('error', onError)
      timeout = window.setTimeout(() => {
        cleanup()
        this.phase = 'failed'
        this.failure = new RecorderError('等待视频编码器结束超时')
        reject(this.failure)
      }, this.stopTimeoutMs)
      if (recorder.state === 'inactive') {
        window.clearTimeout(timeout)
        cleanup()
        finish()
        return
      }
      try {
        recorder.stop()
      } catch (error) {
        cleanup()
        this.phase = 'failed'
        this.failure = new RecorderError('无法停止视频编码器', error)
        reject(this.failure)
      }
    })
    return this.stopPromise
  }

  cancel(): void {
    if (this.phase === 'completed' || this.phase === 'cancelled') return
    this.phase = 'cancelled'
    this.chunks.length = 0
    this.cleanupTracks()
    if (this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop()
      } catch {
        /* 已停止 */
      }
    }
  }
}
