// 导出面板里的数字与帧循环，与 DOM 和 Cesium 解耦，便于单独校验
export const FPS = 30
export const DEFAULT_VIDEO = { orientation: 'portrait' as const, quality: '720' }
// 每百万像素画面帧的渲染秒数：首帧给出真实节奏前的估算
export const SECONDS_PER_MEGAPIXEL_FRAME = 0.1

export type Orientation = 'portrait' | 'landscape'

/** 清晰度是画面的短边，长边按 16:9 算 */
export function videoSize(orientation: Orientation, quality: string): [number, number] {
  const short = Number(quality)
  const long = Math.round((short * 16) / 9)
  return orientation === 'portrait' ? [short, long] : [long, short]
}

export function clock(seconds: number): string {
  const two = (n: number) => String(Math.floor(n)).padStart(2, '0')
  const minutes = Math.floor(seconds / 60)
  return minutes < 60
    ? `${minutes}:${two(seconds % 60)}`
    : `${Math.floor(minutes / 60)}:${two(minutes % 60)}:${two(seconds % 60)}`
}

export function approximately(seconds: number): string {
  const rounded = Math.max(5, Math.round(seconds / 5) * 5)
  if (rounded < 60) return `约 ${rounded} 秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `约 ${minutes} 分钟`
  const rest = minutes % 60
  return `约 ${Math.floor(minutes / 60)} 小时${rest ? ` ${rest} 分钟` : ''}`
}

export function renderEstimate(duration: number, orientation: Orientation, quality: string, fps = FPS): number {
  const [width, height] = videoSize(orientation, quality)
  return Math.round(fps * duration) * ((width * height) / 1e6) * SECONDS_PER_MEGAPIXEL_FRAME
}

/** 编码码率：每像素每帧 0.4 bit，540x960、30 fps 时约 6 Mbit/s */
export const BITS_PER_PIXEL = 0.4

/** 字节数：整段视频在保存前都留在内存里 */
export function fileSize(duration: number, orientation: Orientation, quality: string, fps = FPS): number {
  const [width, height] = videoSize(orientation, quality)
  return (BITS_PER_PIXEL * width * height * fps * duration) / 8
}

export const megabytes = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`

export function tabTitle(percent: number): string {
  return `(${percent}%) 正在渲染飞行视频`
}

export type FrameProgress = { frame: number; frames: number; perFrame?: number }

/**
 * 从 0 到 frames-1 逐帧调用 renderFrame(k)，帧与帧之间检查 signal。
 * 所有帧都渲染完返回 true，signal 提前中断返回 false。
 */
export async function runFrames({
  frames,
  renderFrame,
  onProgress,
  signal,
  now = () => performance.now()
}: {
  frames: number
  renderFrame: (k: number) => Promise<void> | void
  onProgress?: (progress: FrameProgress) => void
  signal?: AbortSignal
  now?: () => number
}): Promise<boolean> {
  const started = now()
  for (let k = 0; k < frames; k++) {
    if (signal?.aborted) return false
    onProgress?.({ frame: k, frames, perFrame: k > 0 ? (now() - started) / 1000 / k : undefined })
    await renderFrame(k)
  }
  return !signal?.aborted
}
