export interface RecordRegion {
  x: number
  y: number
  width: number
  height: number
}

export type CaptionPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface CaptionOptions {
  title?: string
  caption?: string
  position: CaptionPosition
}

export interface MapRecording {
  blob: Blob
  mimeType: string
  extension: 'mp4' | 'webm'
}

export const CAPTION_POSITIONS: readonly CaptionPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
]

export const CAPTION_POSITION_LABELS: Record<CaptionPosition, string> = {
  'top-left': '左上',
  'top-center': '中上',
  'top-right': '右上',
  'bottom-left': '左下',
  'bottom-center': '中下',
  'bottom-right': '右下'
}

export const DEFAULT_FPS = 30
export const MIN_FPS = 10
export const MAX_FPS = 60
export const MIN_REGION_SIZE = 16
export const STOP_TIMEOUT_MS = 10_000

const DEFAULT_VIDEO_BITS_PER_SECOND = 12_000_000

export const MAP_RECORD_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
] as const

export function pickSupportedMimeType(
  candidates: readonly string[],
  isSupported: (type: string) => boolean
): string | null {
  for (const type of candidates) {
    if (isSupported(type)) return type
  }
  return null
}

export function videoExtensionForMime(mimeType: string): 'mp4' | 'webm' {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
}

export function isMapRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    pickSupportedMimeType(MAP_RECORD_MIME_CANDIDATES, (type) => MediaRecorder.isTypeSupported(type)) !== null
  )
}

interface CaptureRect {
  sx: number
  sy: number
  sw: number
  sh: number
  outW: number
  outH: number
}

function toEven(value: number): number {
  const floored = Math.floor(value)
  return Math.max(2, floored - (floored % 2))
}

export function computeCaptureRect(
  region: RecordRegion | null,
  baseWidth: number,
  baseHeight: number,
  cssWidth: number
): CaptureRect | null {
  if (baseWidth < 2 || baseHeight < 2) return null
  if (!region) {
    return { sx: 0, sy: 0, sw: baseWidth, sh: baseHeight, outW: toEven(baseWidth), outH: toEven(baseHeight) }
  }
  const scale = cssWidth > 0 ? baseWidth / cssWidth : 1
  const rawX = region.x * scale
  const rawY = region.y * scale
  const left = Math.min(Math.max(rawX, 0), baseWidth)
  const top = Math.min(Math.max(rawY, 0), baseHeight)
  const right = Math.min(Math.max(rawX + region.width * scale, 0), baseWidth)
  const bottom = Math.min(Math.max(rawY + region.height * scale, 0), baseHeight)
  const sw = right - left
  const sh = bottom - top
  if (sw < 2 || sh < 2) return null
  return { sx: left, sy: top, sw, sh, outW: toEven(sw), outH: toEven(sh) }
}

export function hasCaptionText(options: CaptionOptions | null | undefined): boolean {
  return Boolean(options && (options.title?.trim() || options.caption?.trim()))
}

interface CaptionMetrics {
  titlePx: number
  captionPx: number
  padX: number
  padY: number
  lineGap: number
  margin: number
  radius: number
}

function captionMetrics(outputHeight: number): CaptionMetrics {
  const titlePx = Math.round(Math.min(48, Math.max(14, outputHeight * 0.034)))
  return {
    titlePx,
    captionPx: Math.round(titlePx * 0.66),
    padX: Math.round(titlePx * 0.6),
    padY: Math.round(titlePx * 0.45),
    lineGap: Math.round(titlePx * 0.28),
    margin: Math.round(titlePx * 0.7),
    radius: Math.round(titlePx * 0.3)
  }
}

function captionBoxOrigin(
  position: CaptionPosition,
  boxW: number,
  boxH: number,
  canvasW: number,
  canvasH: number,
  margin: number
): { x: number; y: number } {
  const [vert, horiz] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
  let x: number
  if (horiz === 'left') x = margin
  else if (horiz === 'right') x = canvasW - margin - boxW
  else x = (canvasW - boxW) / 2
  const y = vert === 'top' ? margin : canvasH - margin - boxH
  x = Math.max(margin, Math.min(x, Math.max(margin, canvasW - margin - boxW)))
  const clampedY = Math.max(margin, Math.min(y, Math.max(margin, canvasH - margin - boxH)))
  return { x: Math.round(x), y: Math.round(clampedY) }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rr)
    return
  }
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

const CAPTION_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export function drawCaptionOverlay(
  ctx: CanvasRenderingContext2D,
  options: CaptionOptions | null | undefined,
  outW: number,
  outH: number
): void {
  if (!hasCaptionText(options) || outW < 2 || outH < 2) return
  const title = options?.title?.trim() ?? ''
  const caption = options?.caption?.trim() ?? ''
  const m = captionMetrics(outH)
  const titleFont = `600 ${m.titlePx}px ${CAPTION_FONT_FAMILY}`
  const captionFont = `400 ${m.captionPx}px ${CAPTION_FONT_FAMILY}`

  let textW = 0
  if (title) {
    ctx.font = titleFont
    textW = Math.max(textW, ctx.measureText(title).width)
  }
  if (caption) {
    ctx.font = captionFont
    textW = Math.max(textW, ctx.measureText(caption).width)
  }
  const lineH = (px: number): number => Math.round(px * 1.2)
  const titleLineH = title ? lineH(m.titlePx) : 0
  const captionLineH = caption ? lineH(m.captionPx) : 0
  const innerGap = title && caption ? m.lineGap : 0
  const maxBoxW = Math.max(m.padX * 2 + 8, outW - m.margin * 2)
  const boxW = Math.min(Math.round(textW) + m.padX * 2, maxBoxW)
  const boxH = titleLineH + innerGap + captionLineH + m.padY * 2
  const { x, y } = captionBoxOrigin(options?.position ?? 'bottom-left', boxW, boxH, outW, outH, m.margin)

  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  roundRectPath(ctx, x, y, boxW, boxH, m.radius)
  ctx.fill()

  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  const tx = x + m.padX
  let ty = y + m.padY
  const maxTextW = boxW - m.padX * 2
  if (title) {
    ctx.font = titleFont
    ctx.fillStyle = '#ffffff'
    ctx.fillText(title, tx, ty, maxTextW)
    ty += titleLineH + innerGap
  }
  if (caption) {
    ctx.font = captionFont
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.fillText(caption, tx, ty, maxTextW)
  }
  ctx.restore()
}

export interface RecordCanvasOptions {
  canvas: HTMLCanvasElement
  region?: RecordRegion | null
  caption?: CaptionOptions | null
  fps: number
  signal: AbortSignal
  onStarted?: () => void
  onElapsed?: (seconds: number) => void
  onFrame?: () => void
}

export async function recordCanvas({
  canvas,
  region,
  caption,
  fps,
  signal,
  onStarted,
  onElapsed,
  onFrame
}: RecordCanvasOptions): Promise<MapRecording> {
  const mimeType = pickSupportedMimeType(
    MAP_RECORD_MIME_CANDIDATES,
    (type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)
  )
  if (!mimeType) throw new Error('当前浏览器不支持画布录制')
  const extension = videoExtensionForMime(mimeType)

  const cssWidth = canvas.clientWidth || canvas.width
  const rect = computeCaptureRect(region ?? null, canvas.width, canvas.height, cssWidth)
  if (!rect) throw new Error('录制区域为空或地图尚未就绪')

  const out = document.createElement('canvas')
  out.width = rect.outW
  out.height = rect.outH
  const ctx = out.getContext('2d')
  if (!ctx || typeof out.captureStream !== 'function') throw new Error('当前浏览器不支持画布录制')

  const stream = out.captureStream(fps)
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: DEFAULT_VIDEO_BITS_PER_SECOND })
  } catch {
    for (const track of stream.getTracks()) track.stop()
    throw new Error('当前浏览器不支持画布录制')
  }

  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data)
  }

  let recorderFailed = false
  let failRecording: (error: Error) => void = () => {}
  const finished = new Promise<Blob>((resolve, reject) => {
    failRecording = reject
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
    recorder.onerror = () => {
      recorderFailed = true
      reject(new Error('录制失败：编码器异常'))
    }
  })

  let startedAt = 0
  let lastSeconds = -1
  let rafId = 0
  const drawFrame = (): void => {
    onFrame?.()
    const liveCssWidth = canvas.clientWidth || canvas.width
    const frameRect = computeCaptureRect(region ?? null, canvas.width, canvas.height, liveCssWidth)
    if (frameRect) {
      try {
        ctx.clearRect(0, 0, out.width, out.height)
        ctx.drawImage(
          canvas,
          frameRect.sx,
          frameRect.sy,
          frameRect.sw,
          frameRect.sh,
          0,
          0,
          out.width,
          out.height
        )
        drawCaptionOverlay(ctx, caption, out.width, out.height)
      } catch {
        if (!recorderFailed) {
          recorderFailed = true
          failRecording(new Error('录制失败：地图画布不可读，可能受跨域资源影响'))
        }
      }
    }
    if (recorderFailed) return
    if (startedAt) {
      const seconds = Math.floor((performance.now() - startedAt) / 1000)
      if (seconds !== lastSeconds) {
        lastSeconds = seconds
        onElapsed?.(seconds)
      }
    }
    rafId = requestAnimationFrame(drawFrame)
  }

  const stopRecorder = (): void => {
    if (recorder.state !== 'inactive') recorder.stop()
  }
  signal.addEventListener('abort', stopRecorder, { once: true })

  try {
    recorder.start(1000)
    startedAt = performance.now()
    onStarted?.()
    rafId = requestAnimationFrame(drawFrame)
    await new Promise<void>((resolve) => {
      if (signal.aborted || recorderFailed) {
        resolve()
        return
      }
      const done = (): void => {
        signal.removeEventListener('abort', done)
        resolve()
      }
      signal.addEventListener('abort', done, { once: true })
      void finished.catch(done)
    })
  } finally {
    cancelAnimationFrame(rafId)
    stopRecorder()
    signal.removeEventListener('abort', stopRecorder)
    for (const track of stream.getTracks()) track.stop()
  }

  const timeout = new Promise<Blob>((resolve) => {
    const timer = setTimeout(() => resolve(new Blob(chunks, { type: mimeType })), STOP_TIMEOUT_MS)
    void finished.then(
      () => clearTimeout(timer),
      () => clearTimeout(timer)
    )
  })
  const blob = await Promise.race([finished, timeout])
  return { blob, mimeType, extension }
}
