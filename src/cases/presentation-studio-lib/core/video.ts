import type { ExportSettings } from './types'

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

export function resolutionOf(settings: ExportSettings): { width: number; height: number } {
  switch (settings.resolution) {
    case '4k':
      return { width: 3840, height: 2160 }
    case '2k':
      return { width: 2560, height: 1440 }
    default:
      return { width: 1920, height: 1080 }
  }
}

function bitrateFor(width: number, height: number, fps: number): number {
  return Math.round(Math.min(60_000_000, Math.max(6_000_000, width * height * fps * 0.085)))
}

export interface CompositeExporterOptions {
  source: HTMLCanvasElement
  width: number
  height: number
  fps: number
  mime: string
}

export class CompositeExporter {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly recorder: MediaRecorder
  private readonly chunks: Blob[] = []
  private readonly options: CompositeExporterOptions
  private stopped = false
  private cancelled = false

  constructor(options: CompositeExporterOptions) {
    this.options = options
    this.canvas = document.createElement('canvas')
    this.canvas.width = options.width
    this.canvas.height = options.height
    const context = this.canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('无法创建视频合成画布')
    this.ctx = context
    this.ctx.imageSmoothingEnabled = true
    this.ctx.imageSmoothingQuality = 'high'
    this.ctx.fillStyle = '#040a12'
    this.ctx.fillRect(0, 0, options.width, options.height)
    const stream = this.canvas.captureStream(options.fps)
    this.recorder = new MediaRecorder(stream, {
      mimeType: options.mime,
      videoBitsPerSecond: bitrateFor(options.width, options.height, options.fps)
    })
    this.recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    })
    this.recorder.addEventListener('error', () => {
      this.cancelled = true
    })
    this.recorder.start(220)
  }

  get state(): string {
    return this.recorder.state
  }

  drawFrame(overlay: (ctx: CanvasRenderingContext2D, width: number, height: number) => void): void {
    if (this.stopped) return
    const { source, width, height } = this.options
    this.ctx.fillStyle = '#040a12'
    this.ctx.fillRect(0, 0, width, height)
    const sourceWidth = source.width
    const sourceHeight = source.height
    if (sourceWidth > 0 && sourceHeight > 0) {
      const targetRatio = width / height
      const sourceRatio = sourceWidth / sourceHeight
      let cropWidth = sourceWidth
      let cropHeight = sourceHeight
      let offsetX = 0
      let offsetY = 0
      if (sourceRatio > targetRatio) {
        cropWidth = sourceHeight * targetRatio
        offsetX = (sourceWidth - cropWidth) / 2
      } else {
        cropHeight = sourceWidth / targetRatio
        offsetY = (sourceHeight - cropHeight) / 2
      }
      this.ctx.drawImage(source, offsetX, offsetY, cropWidth, cropHeight, 0, 0, width, height)
    }
    overlay(this.ctx, width, height)
  }

  async stop(): Promise<Blob> {
    if (this.stopped) return new Blob(this.chunks, { type: this.options.mime })
    this.stopped = true
    const recorder = this.recorder
    const result = new Promise<Blob>((resolve) => {
      const finish = () => {
        resolve(new Blob(this.chunks, { type: this.options.mime }))
      }
      if (recorder.state === 'inactive') {
        finish()
        return
      }
      recorder.addEventListener('stop', finish, { once: true })
      recorder.stop()
      setTimeout(finish, 1500)
    })
    return result
  }

  cancel(): void {
    this.cancelled = true
    this.stopped = true
    if (this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop()
      } catch {
        /* 已停止 */
      }
    }
    this.chunks.length = 0
  }

  get wasCancelled(): boolean {
    return this.cancelled
  }
}
