type WebGLTimerContext = WebGL2RenderingContext & {
  TIME_ELAPSED_EXT: number
}
type TimerExtension = {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

interface PendingQuery {
  query: WebGLQuery
  started: boolean
}

export class GpuTimer {
  private readonly gl: WebGL2RenderingContext | null
  private readonly ext: TimerExtension | null
  private pending: PendingQuery[] = []
  private lastMs = 0

  constructor(context: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext ? context : null
    this.ext = this.gl
      ? (this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null)
      : null
  }

  get available(): boolean {
    return Boolean(this.gl && this.ext)
  }

  begin(): void {
    if (!this.gl || !this.ext) return
    const query = this.gl.createQuery()
    if (!query) return
    try {
      this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query)
      this.pending.push({ query, started: true })
    } catch {
      this.gl.deleteQuery(query)
    }
  }

  end(): void {
    if (!this.gl || !this.ext) return
    try {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    } catch {
      return
    }
  }

  poll(): number {
    if (!this.gl || !this.ext) return this.lastMs
    const disjoint = Boolean(this.gl.getParameter(this.ext.GPU_DISJOINT_EXT))
    while (this.pending.length) {
      const item = this.pending[0]
      const available = Boolean(this.gl.getQueryParameter(item.query, this.gl.QUERY_RESULT_AVAILABLE))
      if (!available) break
      const elapsed = Number(this.gl.getQueryParameter(item.query, this.gl.QUERY_RESULT)) / 1e6
      this.pending.shift()
      this.gl.deleteQuery(item.query)
      if (!disjoint && Number.isFinite(elapsed)) this.lastMs = elapsed
    }
    if (disjoint) this.lastMs = 0
    return this.lastMs
  }

  dispose(): void {
    if (!this.gl) return
    for (const item of this.pending) this.gl.deleteQuery(item.query)
    this.pending = []
  }
}
