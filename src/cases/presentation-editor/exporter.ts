import type { Viewer } from 'cesium'
import type { PresentationPlayer } from './player'
import type { SubtitleParam } from './presentation'

export interface ExportOptions {
  viewer: Viewer
  player: PresentationPlayer
  width: number
  height: number
  fps: number
  signal: AbortSignal
  onProgress: (fraction: number) => void
}

export interface ExportResult {
  blob: Blob
  mimeType: string
  extension: 'mp4' | 'webm'
}

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
]

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return null
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of text) {
    const test = line + char
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = char
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

function drawStepBadge(ctx: CanvasRenderingContext2D, label: string, height: number): void {
  const scale = height / 1080
  ctx.save()
  ctx.textBaseline = 'top'
  const badgeFont = Math.round(16 * scale)
  ctx.font = `600 ${badgeFont}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillStyle = 'rgba(8, 22, 40, 0.62)'
  const labelWidth = ctx.measureText(label).width + 26 * scale
  roundRect(ctx, 32 * scale, 28 * scale, labelWidth, 34 * scale, 8 * scale)
  ctx.fill()
  ctx.fillStyle = 'rgba(150, 214, 255, 0.95)'
  ctx.fillText(label, 45 * scale, 37 * scale)
  ctx.restore()
}

function drawSubtitle(
  ctx: CanvasRenderingContext2D,
  subtitle: SubtitleParam,
  width: number,
  height: number
): void {
  const scale = height / 1080
  ctx.save()
  ctx.textBaseline = 'top'

  if (subtitle.text) {
    const fontSize = Math.max(14, subtitle.fontSize * scale * 1.35)
    ctx.font = `700 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
    const lines = wrapLines(ctx, subtitle.text, width * 0.78)
    const subFont = Math.max(11, fontSize * 0.5)
    ctx.font = `500 ${subFont}px "PingFang SC", "Microsoft YaHei", sans-serif`
    const subLines = subtitle.subtext ? wrapLines(ctx, subtitle.subtext, width * 0.72) : []
    const titleLineHeight = fontSize * 1.35
    const subLineHeight = subFont * 1.55
    const blockHeight = lines.length * titleLineHeight + (subLines.length ? subLines.length * subLineHeight + 8 * scale : 0)
    let x = width / 2
    let y = height - blockHeight - 92 * scale
    let align: CanvasTextAlign = 'center'
    if (subtitle.position === 'top') {
      y = 84 * scale
    } else if (subtitle.position === 'left') {
      x = width * 0.08
      align = 'left'
    } else if (subtitle.position === 'right') {
      x = width * 0.92
      align = 'right'
    } else if (subtitle.position === 'fullscreen') {
      y = (height - blockHeight) / 2
    }
    const maxLineWidth = Math.max(
      ...lines.map((line) => {
        ctx.font = `700 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
        return ctx.measureText(line).width
      })
    )
    const boxWidth = Math.min(width * 0.86, maxLineWidth + 70 * scale)
    if (subtitle.background) {
      const boxX = align === 'center' ? x - boxWidth / 2 : align === 'left' ? x - 24 * scale : x - boxWidth + 24 * scale
      ctx.fillStyle = 'rgba(6, 17, 32, 0.66)'
      roundRect(ctx, boxX, y - 18 * scale, boxWidth, blockHeight + 34 * scale, 12 * scale)
      ctx.fill()
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.32)'
      ctx.lineWidth = 1.5 * scale
      ctx.stroke()
    }
    ctx.textAlign = align
    ctx.fillStyle = subtitle.color || '#ffffff'
    ctx.shadowColor = 'rgba(0, 8, 20, 0.8)'
    ctx.shadowBlur = 12 * scale
    ctx.font = `700 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
    let cursorY = y
    for (const line of lines) {
      ctx.fillText(line, x, cursorY)
      cursorY += titleLineHeight
    }
    if (subLines.length) {
      cursorY += 8 * scale
      ctx.font = `500 ${subFont}px "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.fillStyle = 'rgba(176, 213, 243, 0.92)'
      for (const line of subLines) {
        ctx.fillText(line, x, cursorY)
        cursorY += subLineHeight
      }
    }
    ctx.textAlign = 'left'
  }

  ctx.font = `600 ${Math.round(13 * scale)}px "DM Mono", monospace`
  ctx.fillStyle = 'rgba(130, 170, 210, 0.55)'
  ctx.textAlign = 'right'
  ctx.fillText('CESIUM PRESENTATION STUDIO', width - 32 * scale, height - 30 * scale)
  ctx.restore()
}

export async function exportPresentationVideo(options: ExportOptions): Promise<ExportResult> {
  const { viewer, player, width, height, fps, signal, onProgress } = options
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    throw new Error('当前浏览器不支持视频录制（缺少 MediaRecorder / captureStream）')
  }
  const mimeType = pickMimeType()
  if (!mimeType) throw new Error('当前浏览器没有可用的视频编码器')

  const target = document.createElement('canvas')
  target.width = width
  target.height = height
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('无法创建视频画布上下文')
  ctx.fillStyle = '#08111f'
  ctx.fillRect(0, 0, width, height)

  const source = viewer.scene.canvas
  const drawFrame = (): void => {
    if (!source.width || !source.height) return
    ctx.fillStyle = '#08111f'
    ctx.fillRect(0, 0, width, height)
    const scale = Math.min(width / source.width, height / source.height)
    const drawWidth = source.width * scale
    const drawHeight = source.height * scale
    const offsetX = (width - drawWidth) / 2
    const offsetY = (height - drawHeight) / 2
    ctx.drawImage(source, offsetX, offsetY, drawWidth, drawHeight)
    const state = player.getState()
    const stepLabel = `STEP ${state.stepIndex + 1} · ${player.steps[state.stepIndex]?.step.stepName ?? ''}`
    drawStepBadge(ctx, stepLabel, height)
    if (state.subtitle) drawSubtitle(ctx, state.subtitle.param, width, height)
  }

  const stream = target.captureStream(fps)
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.round(Math.min(48_000_000, width * height * fps * 0.12))
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  let raf = 0
  let finished = false
  let aborted = false
  const abortHandler = (): void => {
    aborted = true
    finish()
  }
  signal.addEventListener('abort', abortHandler, { once: true })

  const finish = (): void => {
    if (finished) return
    finished = true
    if (raf) cancelAnimationFrame(raf)
    window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop()
    }, 220)
  }

  viewer.scene.postRender.addEventListener(drawFrame)
  player.pause()
  player.seek(0)
  drawFrame()
  recorder.start(250)

  const startedAt = performance.now()
  const total = player.duration

  const loop = (): void => {
    if (finished) return
    const elapsed = (performance.now() - startedAt) / 1000
    const clamped = Math.min(elapsed, total)
    player.seek(clamped)
    onProgress(total > 0 ? clamped / total : 0)
    if (elapsed >= total + 0.18 || aborted) {
      finish()
      return
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  await stopped
  viewer.scene.postRender.removeEventListener(drawFrame)
  signal.removeEventListener('abort', abortHandler)
  stream.getTracks().forEach((track) => track.stop())
  player.stop()

  if (aborted) throw new DOMException('导出已取消', 'AbortError')
  onProgress(1)
  const blob = new Blob(chunks, { type: mimeType })
  if (blob.size === 0) throw new Error('录制结果为空，请重试')
  return {
    blob,
    mimeType,
    extension: mimeType.includes('mp4') ? 'mp4' : 'webm'
  }
}
