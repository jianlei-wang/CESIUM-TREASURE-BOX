export type EventListener<T = unknown> = (payload: T) => void

/** 轻量发布-订阅事件总线，供图层树模型与控件复用。 */
export class EventEmitter {
  private listeners = new Map<string, Set<EventListener>>()

  on<T = unknown>(event: string, listener: EventListener<T>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as EventListener)
    return () => this.off(event, listener)
  }

  once<T = unknown>(event: string, listener: EventListener<T>): () => void {
    const off = this.on<T>(event, (payload) => {
      off()
      listener(payload)
    })
    return off
  }

  off<T = unknown>(event: string, listener: EventListener<T>): void {
    this.listeners.get(event)?.delete(listener as EventListener)
  }

  emit<T = unknown>(event: string, payload: T): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of [...set]) {
      try {
        listener(payload)
      } catch (error) {
        console.error(`[LayerTree] listener error on "${event}"`, error)
      }
    }
  }

  clear(event?: string): void {
    if (event) this.listeners.delete(event)
    else this.listeners.clear()
  }
}
