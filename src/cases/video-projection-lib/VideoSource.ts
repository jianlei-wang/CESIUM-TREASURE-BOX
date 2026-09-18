import { Texture, type Scene } from 'cesium'

export type VideoSourceOptions = {
  url: string
  muted?: boolean
  loop?: boolean
}

type RendererContext = {
  defaultTexture: Texture
}

function getRendererContext(scene: Scene): RendererContext {
  return (scene as unknown as { context: RendererContext }).context
}

/**
 * HTMLVideoElement 视频源封装。
 *
 * Cesium 的 PostProcessStage 不会像 Material 那样自动逐帧上传视频纹理，
 * 因此这里在首次拿到有效视频帧时创建 Texture，并在每帧通过 copyFrom 手动更新，
 * 保证后处理采样到的是实时画面而不是首帧静帧。
 */
export class VideoSource {
  readonly video: HTMLVideoElement
  private readonly _scene: Scene
  private _texture: Texture | undefined
  private _destroyed = false

  constructor(scene: Scene, options: VideoSourceOptions) {
    this._scene = scene
    this.video = document.createElement('video')
    this.video.src = options.url
    this.video.muted = options.muted ?? true
    this.video.loop = options.loop ?? true
    this.video.playsInline = true
    this.video.crossOrigin = 'anonymous'
    this.video.preload = 'auto'
    this.video.autoplay = true
    this.video.addEventListener('loadeddata', () => {
      void this.video.play().catch(() => undefined)
    })
  }

  get ready(): boolean {
    return this.video.readyState >= 2 && this.video.videoWidth > 0
  }

  get texture(): Texture {
    return this._texture ?? getRendererContext(this._scene).defaultTexture
  }

  get playing(): boolean {
    return !this.video.paused && !this.video.ended
  }

  async open(): Promise<void> {
    if (!this.ready) {
      await new Promise<void>((resolve) => {
        if (this.ready) {
          resolve()
          return
        }
        const onReady = () => {
          this.video.removeEventListener('loadeddata', onReady)
          resolve()
        }
        this.video.addEventListener('loadeddata', onReady)
      })
    }
    await this.video.play().catch(() => undefined)
  }

  updateTexture(): void {
    if (this._destroyed || !this.ready) return
    if (!this._texture) {
      this._texture = new Texture({
        context: getRendererContext(this._scene) as never,
        source: this.video
      })
    } else {
      this._texture.copyFrom({ source: this.video })
    }
  }

  play(): void {
    void this.video.play().catch(() => undefined)
  }

  pause(): void {
    this.video.pause()
  }

  destroy(): void {
    this._destroyed = true
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
    if (this._texture) {
      this._texture.destroy()
      this._texture = undefined
    }
  }
}
