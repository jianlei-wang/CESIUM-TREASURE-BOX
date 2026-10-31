import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import type { Viewer } from 'cesium'
import type FlyoverCaptions from './flyover-captions'

// 导出时每渲染一帧，就再渲染一次“前方一秒”的画面，让这些瓦片在下一帧还在编码时开始请求：
// 冷瓦片缓存下能把导出时间砍掉一半。
const LOOK_AHEAD = 1

// 让出一次事件循环，给瓦片请求和地形 worker 回应。用 MessageChannel 而不是定时器：
// 后台标签页的定时器会被降频到每秒甚至每分钟一次，而导出常在后台标签页里跑上几分钟。
const channel = new MessageChannel()
const yieldToBrowser = () => new Promise<void>((resolve) => {
  channel.port1.onmessage = () => resolve()
  channel.port2.postMessage(undefined)
})

export const BITS_PER_PIXEL = 0.4
export const FPS = 30

export type FlyoverLike = {
  duration: number
  progress: number
}

export type ExportProgress = { frame: number; frames: number; perFrame?: number }

export type ExportOptions = {
  viewer: Viewer
  flyover: FlyoverLike
  captions?: Pick<FlyoverCaptions, 'active' | 'canvas'>
  width: number
  height: number
  fps?: number
  onProgress?: (progress: ExportProgress) => void
  signal?: AbortSignal
}

export function videoSupport(): { supported: boolean; codec: string; reason?: string } {
  const codec = 'avc1.42001f'
  if (typeof window === 'undefined' || typeof (window as any).VideoEncoder !== 'function') {
    return { supported: false, codec, reason: '当前浏览器不支持 WebCodecs 的 VideoEncoder' }
  }
  return { supported: true, codec }
}

export async function isCodecSupported(codec: string, width: number, height: number, fps: number): Promise<boolean> {
  if (typeof (window as any).VideoEncoder !== 'function') return false
  try {
    const support = await (window as any).VideoEncoder.isConfigSupported({
      codec,
      width,
      height,
      bitrate: Math.round(BITS_PER_PIXEL * width * height * fps),
      framerate: fps
    })
    return Boolean(support?.supported)
  } catch {
    return false
  }
}

/**
 * 逐帧导出整段飞行：每帧都等到视野里的瓦片全部加载，所以并不实时。
 * 画面按实时视图的方式渲染，只是不带 HDR：视频压缩会把 HDR 带来的差异抹平。
 * 无论成功失败，viewer 都会被还原成导出前的状态。
 */
export async function exportFlyover({
  viewer,
  flyover,
  captions,
  width,
  height,
  fps = FPS,
  onProgress,
  signal
}: ExportOptions): Promise<Blob | undefined> {
  const scene = viewer.scene
  const globe = scene.globe
  const controller = scene.screenSpaceCameraController
  const VideoEncoderCtor = (window as any).VideoEncoder
  const VideoFrameCtor = (window as any).VideoFrame
  if (typeof VideoEncoderCtor !== 'function' || typeof VideoFrameCtor !== 'function') {
    throw new Error('当前浏览器不支持 WebCodecs，无法导出视频')
  }
  const codec = 'avc1.42001f'
  const config = {
    codec,
    width,
    height,
    bitrate: Math.round(BITS_PER_PIXEL * width * height * fps),
    framerate: fps,
    avc: { format: 'avc' as const }
  }
  const support = await VideoEncoderCtor.isConfigSupported(config)
  if (!support?.supported) {
    throw new Error(`当前浏览器不支持 H.264 编码（${width}x${height} @ ${fps}fps）`)
  }

  const saved = {
    cache: globe.tileCacheSize,
    inputs: controller.enableInputs,
    recommended: viewer.useBrowserRecommendedResolution,
    scale: viewer.resolutionScale
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory'
  })
  let encoderError: Error | undefined
  const encoder = new VideoEncoderCtor({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (error: Error) => {
      encoderError = error
    }
  })
  encoder.configure(config)

  try {
    globe.tileCacheSize = 5000
    // 两帧之间用户在图上拖动会把下一帧的相机带走
    controller.enableInputs = false
    // 组件自带的循环每帧都会渲染，相机移动时几乎是每导出一帧渲染三次，纯属浪费
    viewer.useDefaultRenderLoop = false
    // 绘制缓冲直接取视频尺寸：浏览器推荐分辨率是一 CSS 像素一像素，
    // 设备像素比会把它放大两三倍
    viewer.useBrowserRecommendedResolution = true
    viewer.resolutionScale = 1
    viewer.resize()

    // 每帧是地图加上叠加的说明文字
    const frame = document.createElement('canvas')
    frame.width = width
    frame.height = height
    const context = frame.getContext('2d') as CanvasRenderingContext2D

    const frames = Math.max(1, Math.round(fps * flyover.duration))
    const started = performance.now()
    let rendered = 0
    for (let k = 0; k < frames; k++) {
      if (signal?.aborted) {
        encoder.close()
        return undefined
      }
      if (encoderError) throw encoderError
      onProgress?.({ frame: k, frames, perFrame: k > 0 ? (performance.now() - started) / 1000 / k : undefined })

      const ahead = k + Math.round(LOOK_AHEAD * fps)
      if (k > 0 && captions && ahead < frames) {
        // 这不是导出画面的一帧：说明文字的名片计时会读到一次跳跃
        const active = captions.active
        captions.active = false
        flyover.progress = ahead / (frames - 1)
        scene.render()
        captions.active = active
      }
      flyover.progress = k / (frames - 1)
      // 每次渲染瓦片只前进一级，所以每帧要循环几次
      let guard = 0
      do {
        scene.render()
        await yieldToBrowser()
      } while (!globe.tilesLoaded && !signal?.aborted && guard++ < 600)
      // 绘制缓冲不会被保留：必须在同一次任务里复制出来
      scene.render()
      context.drawImage(scene.canvas, 0, 0, width, height)
      if (captions?.active) context.drawImage(captions.canvas, 0, 0, width, height)

      const videoFrame = new VideoFrameCtor(frame, {
        timestamp: Math.round((k * 1e6) / fps),
        duration: Math.round(1e6 / fps)
      })
      // 每个关键帧都强制独立，让导出在任意处都能切开；间隔两秒
      encoder.encode(videoFrame, { keyFrame: k % (fps * 2) === 0 })
      videoFrame.close()
      rendered++
      // 别让编码队列无限增长，内存会撑爆
      while (encoder.encodeQueueSize > 8) await yieldToBrowser()
    }
    if (encoderError) throw encoderError
    if (signal?.aborted) {
      encoder.close()
      return undefined
    }
    await encoder.flush()
    encoder.close()
    if (encoderError) throw encoderError
    muxer.finalize()
    return new Blob([muxer.target.buffer], { type: 'video/mp4' })
  } finally {
    try {
      if (encoder.state !== 'closed') encoder.close()
    } catch {
      // 关闭时的状态错误无关紧要
    }
    globe.tileCacheSize = saved.cache
    controller.enableInputs = saved.inputs
    viewer.useBrowserRecommendedResolution = saved.recommended
    viewer.resolutionScale = saved.scale
    viewer.useDefaultRenderLoop = true
    viewer.resize()
    flyover.progress = 0
  }
}
