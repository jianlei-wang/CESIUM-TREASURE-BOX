import JSZip from 'jszip'
import type { RuntimeState } from './types'
import { CompositeExporter, RecorderError, detectRecorderFormat } from './video'
import { drawFittedSource, type OutputProfile } from './export-profile'

export interface ExportDiagnostics {
  profile: OutputProfile
  totalFrames: number
  renderedFrames: number
  durationSeconds: number
  startedAt: string
  finishedAt: string
  warnings: string[]
}

export interface ExportProgress {
  phase: 'preparing' | 'recording' | 'finalizing' | 'done' | 'error' | 'cancelled'
  progress: number
  frame: number
  totalFrames: number
  message: string
  diagnostics?: ExportDiagnostics
}

export interface ExportContext {
  profile: OutputProfile
  totalSeconds: number
  signal: AbortSignal
  evaluate: (seconds: number) => RuntimeState
  apply: (runtime: RuntimeState) => void
  requestRender: () => void
  waitUntilVisible: () => Promise<void>
  sourceCanvas: () => HTMLCanvasElement | null
  drawOverlay: (ctx: CanvasRenderingContext2D, width: number, height: number, runtime: RuntimeState) => void
  onProgress: (progress: ExportProgress) => void
}

export interface ExportOutput {
  blob: Blob
  extension: string
  mime: string
  diagnostics: ExportDiagnostics
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('无法生成逐帧图像'))
    }, type)
  })
}

function abortError(): DOMException {
  return new DOMException('导出已取消', 'AbortError')
}

function startedDiagnostics(context: ExportContext, totalFrames: number): ExportDiagnostics {
  return {
    profile: context.profile,
    totalFrames,
    renderedFrames: 0,
    durationSeconds: context.totalSeconds,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    warnings: []
  }
}

export async function exportRealtime(context: ExportContext): Promise<ExportOutput> {
  const { profile, signal, evaluate, apply, requestRender, sourceCanvas, drawOverlay, onProgress } = context
  const totalFrames = Math.max(1, Math.round(context.totalSeconds * profile.fps))
  const diagnostics = startedDiagnostics(context, totalFrames)
  onProgress({ phase: 'preparing', progress: 0, frame: 0, totalFrames, message: '等待场景资源就绪' })
  await context.waitUntilVisible()
  const source = sourceCanvas()
  if (!source) throw new Error('三维场景画布尚未就绪')
  apply(evaluate(0))
  requestRender()
  await nextAnimationFrame()
  await nextAnimationFrame()

  const format = detectRecorderFormat()
  if (!format) throw new Error('当前浏览器不支持视频编码')
  const exporter = new CompositeExporter({
    source,
    width: profile.width,
    height: profile.height,
    fps: profile.fps,
    mime: format.mime,
    fit: profile.fit,
    background: profile.background
  })

  const startedAt = performance.now()
  let rendered = 0
  return new Promise<ExportOutput>((resolve, reject) => {
    let raf = 0
    const onAbort = (): void => {
      cancelAnimationFrame(raf)
      exporter.cancel()
      onProgress({
        phase: 'cancelled',
        progress: 0,
        frame: rendered,
        totalFrames,
        message: '导出已取消',
        diagnostics
      })
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })

    const finish = async (): Promise<void> => {
      signal.removeEventListener('abort', onAbort)
      onProgress({ phase: 'finalizing', progress: 1, frame: rendered, totalFrames, message: '正在封装视频文件' })
      try {
        const blob = await exporter.stop()
        diagnostics.renderedFrames = rendered
        diagnostics.finishedAt = new Date().toISOString()
        if (Math.abs(rendered - totalFrames) > 1) {
          diagnostics.warnings.push(`实时导出渲染 ${rendered} 帧，目标 ${totalFrames} 帧；实时模式受设备性能影响`)
        }
        onProgress({
          phase: 'done',
          progress: 1,
          frame: rendered,
          totalFrames,
          message: '视频已生成',
          diagnostics
        })
        resolve({ blob, extension: format.extension, mime: format.mime, diagnostics })
      } catch (error) {
        const message = error instanceof RecorderError ? error.message : '视频封装失败'
        onProgress({ phase: 'error', progress: 0, frame: rendered, totalFrames, message, diagnostics })
        reject(error instanceof Error ? error : new Error(message))
      }
    }

    const loop = (timestamp: number): void => {
      if (signal.aborted) return
      const elapsed = Math.min(context.totalSeconds, (timestamp - startedAt) / 1000)
      const runtime = evaluate(elapsed)
      apply(runtime)
      exporter.drawFrame((ctx, width, height) => drawOverlay(ctx, width, height, runtime), source)
      rendered += 1
      onProgress({
        phase: 'recording',
        progress: context.totalSeconds > 0 ? Math.min(1, elapsed / context.totalSeconds) : 1,
        frame: rendered,
        totalFrames,
        message: `实时渲染 ${Math.floor(elapsed)}s / ${Math.ceil(context.totalSeconds)}s`
      })
      if (elapsed >= context.totalSeconds) {
        void finish()
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
  })
}

export async function exportFrameSequence(context: ExportContext): Promise<ExportOutput> {
  const { profile, signal, evaluate, apply, requestRender, sourceCanvas, drawOverlay, onProgress } = context
  const totalFrames = Math.max(1, Math.round(context.totalSeconds * profile.fps))
  const diagnostics = startedDiagnostics(context, totalFrames)
  onProgress({ phase: 'preparing', progress: 0, frame: 0, totalFrames, message: '检查资源就绪状态' })
  await context.waitUntilVisible()
  const source = sourceCanvas()
  if (!source) throw new Error('三维场景画布尚未就绪')

  const target = document.createElement('canvas')
  target.width = profile.width
  target.height = profile.height
  const ctx = target.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('无法创建逐帧导出画布')
  const zip = new JSZip()
  const framesFolder = zip.folder('frames')
  if (!framesFolder) throw new Error('无法创建逐帧目录')

  const estimatedBytes = profile.width * profile.height * 0.75 * totalFrames
  if (estimatedBytes > 1_500_000_000) {
    diagnostics.warnings.push('逐帧序列预计超过 1.5GB，建议缩短时长或降低分辨率')
  }

  const srt: Array<{ start: number; end: number; text: string }> = []
  let lastSubtitle = ''
  let subtitleStart = 0

  for (let frame = 0; frame < totalFrames; frame += 1) {
    if (signal.aborted) {
      onProgress({
        phase: 'cancelled',
        progress: frame / totalFrames,
        frame,
        totalFrames,
        message: '导出已取消',
        diagnostics
      })
      throw abortError()
    }
    const seconds = frame / profile.fps
    const runtime = evaluate(seconds)
    apply(runtime)
    requestRender()
    await context.waitUntilVisible()
    await nextAnimationFrame()
    await nextAnimationFrame()
    drawFittedSource(
      ctx,
      source,
      source.width,
      source.height,
      target.width,
      target.height,
      profile.fit,
      profile.background
    )
    drawOverlay(ctx, target.width, target.height, runtime)
    const blob = await canvasToBlob(target)
    framesFolder.file(`frame_${String(frame + 1).padStart(6, '0')}.png`, blob)

    const subtitle = runtime.subtitles[0]?.param
    const subtitleText = subtitle ? [subtitle.title, subtitle.text].filter(Boolean).join(' · ') : ''
    if (subtitleText !== lastSubtitle) {
      if (lastSubtitle) srt.push({ start: subtitleStart, end: seconds, text: lastSubtitle })
      lastSubtitle = subtitleText
      subtitleStart = seconds
    }

    diagnostics.renderedFrames = frame + 1
    onProgress({
      phase: 'recording',
      progress: (frame + 1) / totalFrames,
      frame: frame + 1,
      totalFrames,
      message: `逐帧渲染 ${frame + 1} / ${totalFrames}`
    })
  }
  if (lastSubtitle) srt.push({ start: subtitleStart, end: context.totalSeconds, text: lastSubtitle })

  if (srt.length) {
    zip.file('subtitles.srt', formatSrt(srt))
  }
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        format: 'cesium.studio.frames',
        profile,
        totalFrames,
        durationSeconds: totalFrames / profile.fps,
        createdAt: new Date().toISOString()
      },
      null,
      2
    )
  )
  onProgress({ phase: 'finalizing', progress: 1, frame: totalFrames, totalFrames, message: '正在打包逐帧序列' })
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  diagnostics.finishedAt = new Date().toISOString()
  onProgress({ phase: 'done', progress: 1, frame: totalFrames, totalFrames, message: '逐帧序列已生成', diagnostics })
  return { blob, extension: 'zip', mime: 'application/zip', diagnostics }
}

function formatSrt(entries: Array<{ start: number; end: number; text: string }>): string {
  const stamp = (seconds: number): string => {
    const safe = Math.max(0, seconds)
    const hours = Math.floor(safe / 3600)
    const minutes = Math.floor((safe - hours * 3600) / 60)
    const rest = safe - hours * 3600 - minutes * 60
    const whole = Math.floor(rest)
    const millis = Math.round((rest - whole) * 1000)
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')},${String(millis).padStart(3, '0')}`
  }
  return entries
    .map((entry, index) => `${index + 1}\n${stamp(entry.start)} --> ${stamp(entry.end)}\n${entry.text}\n`)
    .join('\n')
}
