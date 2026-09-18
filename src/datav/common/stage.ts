/**
 * 大屏画布（3D canvas + HUD）按 1920×1080 设计稿等比缩放，居中适配容器。
 * 引擎应挂到 stageEl，使三维场景与覆盖层同步缩放、对齐。
 */
export class FitStage {
  readonly stageEl: HTMLElement
  readonly width: number
  readonly height: number

  private container: HTMLElement
  private observer: ResizeObserver | null = null

  constructor(container: HTMLElement, stageEl: HTMLElement, designWidth = 1920, designHeight = 1080) {
    this.container = container
    this.stageEl = stageEl
    this.width = designWidth
    this.height = designHeight
    this.stageEl.style.position = 'absolute'
    this.stageEl.style.left = '0'
    this.stageEl.style.top = '0'
    this.stageEl.style.width = `${designWidth}px`
    this.stageEl.style.height = `${designHeight}px`
    this.stageEl.style.transformOrigin = '0 0'
    this.stageEl.style.willChange = 'transform'
    this.stageEl.style.right = 'auto'
    this.stageEl.style.bottom = 'auto'
    this.stageEl.style.overflow = 'hidden'
    this.apply()

    this.observer = new ResizeObserver(() => this.apply())
    this.observer.observe(container)
  }

  private apply(): void {
    const cw = this.container.clientWidth || 1
    const ch = this.container.clientHeight || 1
    const scale = Math.min(cw / this.width, ch / this.height)
    const dx = (cw - this.width * scale) / 2
    const dy = (ch - this.height * scale) / 2
    this.stageEl.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`
  }

  dispose(): void {
    this.observer?.disconnect()
    this.observer = null
  }
}
