import { Cartesian3, type Viewer } from 'cesium'

export interface TourKeyframe {
  id: string
  longitude: number
  latitude: number
  height: number
  /** 弧度 */
  heading: number
  /** 弧度 */
  pitch: number
  /** 弧度 */
  roll: number
  /** 在该视角停留的秒数 */
  holdSeconds: number
  /** 从该视角飞往下一点的秒数（最后一点不用） */
  transitionSeconds: number
}

export type TourKeyframeData = Omit<TourKeyframe, 'id'>
export type TourCameraPose = Omit<TourKeyframe, 'id' | 'holdSeconds' | 'transitionSeconds'>

export const DEFAULT_FPS = 30
export const MIN_FPS = 10
export const MAX_FPS = 60
export const DEFAULT_HOLD_SECONDS = 1
export const MIN_HOLD_SECONDS = 0
export const MAX_HOLD_SECONDS = 60
export const DEFAULT_SEGMENT_SECONDS = 4
export const MIN_SEGMENT_SECONDS = 0.5
export const MAX_SEGMENT_SECONDS = 30
export const STOP_TIMEOUT_MS = 10_000
export const TOUR_CONFIG_TYPE = 'cesium-tour'
export const TOUR_CONFIG_VERSION = 1

const DEFAULT_VIDEO_BITS_PER_SECOND = 12_000_000
const MAX_KEYFRAMES = 500

export const TOUR_MIME_CANDIDATES = [
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

export function isTourRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    pickSupportedMimeType(TOUR_MIME_CANDIDATES, (type) => MediaRecorder.isTypeSupported(type)) !== null
  )
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function estimateTourDurationMs(
  keyframes: readonly Pick<TourKeyframe, 'holdSeconds' | 'transitionSeconds'>[]
): number {
  if (keyframes.length === 0) return 0
  const holds = keyframes.reduce((sum, kf) => sum + Math.max(0, kf.holdSeconds), 0)
  if (keyframes.length < 2) return holds * 1000
  const transitions = keyframes
    .slice(0, -1)
    .reduce((sum, kf) => sum + Math.max(0, kf.transitionSeconds), 0)
  return (holds + transitions) * 1000
}

export function serializeTourConfig(keyframes: readonly TourKeyframe[], fps: number): string {
  const config = {
    type: TOUR_CONFIG_TYPE,
    version: TOUR_CONFIG_VERSION,
    fps: Math.round(clampNumber(fps, MIN_FPS, MAX_FPS)),
    keyframes: keyframes.map(
      ({ id: _id, holdSeconds, transitionSeconds, ...rest }): TourKeyframeData => ({
        ...rest,
        holdSeconds: clampNumber(holdSeconds, MIN_HOLD_SECONDS, MAX_HOLD_SECONDS),
        transitionSeconds: clampNumber(transitionSeconds, MIN_SEGMENT_SECONDS, MAX_SEGMENT_SECONDS)
      })
    )
  }
  return `${JSON.stringify(config, null, 2)}\n`
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parseKeyframe(raw: unknown): TourKeyframeData {
  if (!raw || typeof raw !== 'object') throw new Error('导览配置包含无效的关键帧')
  const kf = raw as Record<string, unknown>
  const longitude = num(kf.longitude, Number.NaN)
  const latitude = num(kf.latitude, Number.NaN)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    throw new Error('导览配置关键帧坐标无效')
  }
  return {
    longitude,
    latitude,
    height: num(kf.height, 10000),
    heading: num(kf.heading, 0),
    pitch: clampNumber(num(kf.pitch, -Math.PI / 2), -Math.PI / 2, Math.PI / 3),
    roll: num(kf.roll, 0),
    holdSeconds: clampNumber(num(kf.holdSeconds, DEFAULT_HOLD_SECONDS), MIN_HOLD_SECONDS, MAX_HOLD_SECONDS),
    transitionSeconds: clampNumber(
      num(kf.transitionSeconds, DEFAULT_SEGMENT_SECONDS),
      MIN_SEGMENT_SECONDS,
      MAX_SEGMENT_SECONDS
    )
  }
}

export function parseTourConfig(text: string): { fps: number; keyframes: TourKeyframeData[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('导览配置文件不是合法 JSON')
  }
  if (!raw || typeof raw !== 'object') throw new Error('导览配置文件格式不正确')
  const obj = raw as Record<string, unknown>
  if (obj.type !== TOUR_CONFIG_TYPE) throw new Error('该文件不是本控件的导览配置')
  if (!Array.isArray(obj.keyframes) || obj.keyframes.length === 0) {
    throw new Error('导览配置没有关键帧')
  }
  if (obj.keyframes.length > MAX_KEYFRAMES) throw new Error('导览配置关键帧数量过多')
  const fps = Math.round(clampNumber(num(obj.fps, DEFAULT_FPS), MIN_FPS, MAX_FPS))
  const keyframes = obj.keyframes.map(parseKeyframe)
  return { fps, keyframes }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function flyToKeyframe(viewer: Viewer, kf: TourKeyframe, durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const duration = Math.max(0, durationMs)
    const timer = setTimeout(finish, duration + Math.max(500, duration * 0.25))
    signal.addEventListener('abort', finish, { once: true })
    if (viewer.isDestroyed()) {
      finish()
      return
    }
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(kf.longitude, kf.latitude, kf.height),
      orientation: { heading: kf.heading, pitch: kf.pitch, roll: kf.roll },
      duration: duration / 1000,
      complete: finish,
      cancel: finish
    })
  })
}

export interface RecordTourOptions {
  viewer: Viewer
  keyframes: readonly TourKeyframe[]
  fps: number
  signal: AbortSignal
  onProgress?: (fraction: number) => void
}

export async function recordTour({
  viewer,
  keyframes,
  fps,
  signal,
  onProgress
}: RecordTourOptions): Promise<Blob> {
  if (keyframes.length < 2) throw new Error('导览至少需要两个关键帧')
  const mimeType = pickSupportedMimeType(
    TOUR_MIME_CANDIDATES,
    (type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)
  )
  if (!mimeType) throw new Error('当前浏览器不支持画布录制')
  const canvas = viewer.canvas
  if (typeof canvas.captureStream !== 'function') throw new Error('当前浏览器不支持画布录制')

  const stream = canvas.captureStream(fps)
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: DEFAULT_VIDEO_BITS_PER_SECOND })
  } catch {
    for (const track of stream.getTracks()) track.stop()
    throw new Error('当前浏览器不支持画布录制')
  }

  const stopOnAbort = (): void => {
    if (!viewer.isDestroyed()) viewer.camera.cancelFlight()
  }
  signal.addEventListener('abort', stopOnAbort, { once: true })

  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data)
  }

  let recorderFailed = false
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
    recorder.onerror = () => {
      recorderFailed = true
      reject(new Error('录制失败：编码器异常'))
    }
  })

  const controller = viewer.scene.screenSpaceCameraController
  const previousInputs = controller.enableInputs
  controller.enableInputs = false

  const totalMs = estimateTourDurationMs(keyframes)
  let startedAt = 0
  let lastPercent = -1
  let rafId = 0
  const pump = (): void => {
    if (!viewer.isDestroyed()) viewer.scene.requestRender()
    if (startedAt && totalMs > 0) {
      const percent = Math.min(100, Math.round(((performance.now() - startedAt) / totalMs) * 100))
      if (percent !== lastPercent) {
        lastPercent = percent
        onProgress?.(percent / 100)
      }
    }
    rafId = requestAnimationFrame(pump)
  }

  try {
    const first = keyframes[0]
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(first.longitude, first.latitude, first.height),
      orientation: { heading: first.heading, pitch: first.pitch, roll: first.roll }
    })
    recorder.start(1000)
    startedAt = performance.now()
    rafId = requestAnimationFrame(pump)

    for (let i = 0; i < keyframes.length; i += 1) {
      if (signal.aborted || recorderFailed) break
      await delay(Math.max(0, keyframes[i].holdSeconds * 1000), signal)
      if (i < keyframes.length - 1 && !signal.aborted && !recorderFailed) {
        await flyToKeyframe(viewer, keyframes[i + 1], Math.round(keyframes[i].transitionSeconds * 1000), signal)
      }
    }
    if (!signal.aborted && !recorderFailed) onProgress?.(1)
  } finally {
    controller.enableInputs = previousInputs
    cancelAnimationFrame(rafId)
    if (recorder.state !== 'inactive') recorder.stop()
    signal.removeEventListener('abort', stopOnAbort)
    for (const track of stream.getTracks()) track.stop()
  }

  const timeout = new Promise<Blob>((resolve) => {
    const timer = setTimeout(() => resolve(new Blob(chunks, { type: mimeType })), STOP_TIMEOUT_MS)
    void finished.then(
      () => clearTimeout(timer),
      () => clearTimeout(timer)
    )
  })
  return await Promise.race([finished, timeout])
}
