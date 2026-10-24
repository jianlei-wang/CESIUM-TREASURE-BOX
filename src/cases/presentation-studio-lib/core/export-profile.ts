import type { ExportSettings } from './types'

export type OutputFit = 'contain' | 'cover' | 'stretch'
export type ExportMode = 'realtime' | 'deterministic'
export type ExportFormat = 'video' | 'frames'

export interface OutputProfile {
  id: string
  name: string
  width: number
  height: number
  fps: number
  fit: OutputFit
  background: string
  mode: ExportMode
  format: ExportFormat
}

export interface ExportOptions extends ExportSettings {
  fit?: OutputFit
  mode?: ExportMode
  format?: ExportFormat
}

export const DEFAULT_OUTPUT_PROFILE: OutputProfile = {
  id: 'output_1080p30_fast',
  name: '1080P 实时快速导出',
  width: 1920,
  height: 1080,
  fps: 30,
  fit: 'contain',
  background: '#040a12',
  mode: 'realtime',
  format: 'video'
}

export const OUTPUT_PROFILES: OutputProfile[] = [
  DEFAULT_OUTPUT_PROFILE,
  {
    id: 'output_1080p60_fast',
    name: '1080P 60FPS 实时导出',
    width: 1920,
    height: 1080,
    fps: 60,
    fit: 'contain',
    background: '#040a12',
    mode: 'realtime',
    format: 'video'
  },
  {
    id: 'output_1080p30_frames',
    name: '1080P 确定性逐帧序列',
    width: 1920,
    height: 1080,
    fps: 30,
    fit: 'contain',
    background: '#040a12',
    mode: 'deterministic',
    format: 'frames'
  },
  {
    id: 'output_4k30_frames',
    name: '4K 确定性逐帧序列',
    width: 3840,
    height: 2160,
    fps: 30,
    fit: 'contain',
    background: '#040a12',
    mode: 'deterministic',
    format: 'frames'
  }
]

export function profileFor(options: ExportOptions): OutputProfile {
  const base = resolutionOf(options)
  return {
    id: `${base.width}x${base.height}@${options.fps}-${options.mode ?? 'realtime'}`,
    name: `${options.resolution.toUpperCase()} ${options.fps}FPS`,
    width: base.width,
    height: base.height,
    fps: options.fps,
    fit: options.fit ?? 'contain',
    background: DEFAULT_OUTPUT_PROFILE.background,
    mode: options.mode ?? 'realtime',
    format: options.format ?? 'video'
  }
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

export interface FitRect {
  x: number
  y: number
  width: number
  height: number
}

export function fitRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: OutputFit
): FitRect {
  if (sourceWidth <= 0 || sourceHeight <= 0) return { x: 0, y: 0, width: targetWidth, height: targetHeight }
  if (fit === 'stretch') return { x: 0, y: 0, width: targetWidth, height: targetHeight }
  const scale =
    fit === 'cover'
      ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
      : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height }
}

export function drawFittedSource(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  fit: OutputFit,
  background: string
): FitRect {
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)
  if (sourceWidth <= 0 || sourceHeight <= 0) return { x: 0, y: 0, width, height }
  const rect = fitRect(sourceWidth, sourceHeight, width, height, fit)
  if (fit === 'cover') {
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
    ctx.drawImage(source, offsetX, offsetY, cropWidth, cropHeight, 0, 0, width, height)
    return { x: 0, y: 0, width, height }
  }
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height)
  return rect
}
