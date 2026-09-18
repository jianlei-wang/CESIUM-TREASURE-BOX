export type TooltipStyle = {
  offsetX?: number
  offsetY?: number
  className?: string
}

export class MouseTooltip {
  private el: HTMLDivElement | undefined
  private parent: HTMLElement
  private offsetX: number
  private offsetY: number
  private className: string
  private visible = false

  constructor(parent: HTMLElement, style: TooltipStyle = {}) {
    this.parent = parent
    this.offsetX = style.offsetX ?? 14
    this.offsetY = style.offsetY ?? -34
    this.className = style.className ?? 'measure-tooltip'
  }

  ensure(): HTMLDivElement {
    if (this.el) return this.el
    const el = document.createElement('div')
    el.className = this.className
    el.style.position = 'absolute'
    el.style.pointerEvents = 'none'
    el.style.zIndex = '1000'
    el.style.display = 'none'
    this.parent.appendChild(el)
    this.el = el
    return el
  }

  show(): void {
    const el = this.ensure()
    el.style.display = 'block'
    this.visible = true
  }

  hide(): void {
    if (!this.el) return
    this.el.style.display = 'none'
    this.visible = false
  }

  isVisible(): boolean {
    return this.visible
  }

  setContent(html: string): void {
    this.ensure().innerHTML = html
  }

  setPosition(canvasX: number, canvasY: number): void {
    const el = this.ensure()
    el.style.left = `${canvasX + this.offsetX}px`
    el.style.top = `${canvasY + this.offsetY}px`
  }

  destroy(): void {
    if (this.el && this.el.parentNode === this.parent) {
      this.parent.removeChild(this.el)
    }
    this.el = undefined
  }
}
