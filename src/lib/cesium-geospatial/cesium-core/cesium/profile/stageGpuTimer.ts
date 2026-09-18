// 逐 stage GPU 计时（EXT_disjoint_timer_query_webgl2）。
// 评审 C2：包 stage.execute 包 begin/endQuery(TIME_ELAPSED_EXT)；ring buffer 跨帧异步读——
// 就绪门是轮询 QUERY_RESULT_AVAILABLE_EXT（本身非阻塞，立即读 QUERY_RESULT 才会 stall pipeline）；
// 每帧先查 GPU_DISJOINT_EXT 置位则整帧丢弃；扩展缺失 supported=false（fallback 由上层 toggle-diff）。
// 评审 C3：timer query 直读 ms 不受 vsync 影响（主手段），FPS 差值仅解锁后交叉验证。
//
// 与 plan 原稿的偏差（均不改其自带单测，4/4 通过）：
//  1. read 就绪门：plan 原稿另有 `framesAgo<2 跳过` 硬门，但其单测（用例2/4）从不调 tickFrame()，
//     framesAgo 恒 0，会致 resolveLast 后仍 read null、与「4/4 通过」互斥。单测把 resolveLast()
//     （置 available）视为「跨帧后结果就绪」的模拟，故就绪门定为轮询 available；framesAgo/tickFrame
//     随之成为只写不读的死代码，质量评审后移除（Task 2 不需要 tickFrame，勿在渲染循环里调它）。
//  2. query 方法来源 + endQuery 传参：plan 把 createQuery/beginQuery/endQuery/getQueryParameter
//     全挂 ext 对象且 end() 传 null。真实 WebGL2 这些是核心 API、在 gl 上，ext 仅给常量；假 gl 的
//     endQuery mock 又需真实 query 对象。故构造时归一化来源（ext 优先、回落 gl 核心），end 恒传
//     当前活跃 query（真实 gl.endQuery(target) 忽略多余第二参，安全）。
//  3. read drain 顺序（质量评审 Important）：begin 用 push 把新 query 加到数组尾（最新在尾），
//     原降序遍历会让最旧值最后写入胜出（Task 2 每帧 begin/end、每 60 帧 read，pending 积约 60 个，
//     一次 drain 上报 ~60 帧前旧值）。改升序遍历 + 收集后统一删，让最新（数组尾）覆盖旧值。

interface TimerQueryExt {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
  createQuery(): unknown
  deleteQuery(q: unknown): void
  beginQuery(target: number, q: unknown): void
  endQuery(target: number, q: unknown): void
  getQueryParameter(q: unknown, pname: number): unknown
}

const QUERY_RESULT_EXT = 0x8866
const QUERY_RESULT_AVAILABLE_EXT = 0x8867

export class StageGpuTimer {
  readonly supported: boolean
  private ext: TimerQueryExt | null
  private gl: WebGL2RenderingContext
  // 每 stage 的在飞 query 队列（数组尾为最新）。read 时 drain 出已就绪者。
  private pending = new Map<string, unknown[]>()
  private results = new Map<string, number>()
  private activeQuery: unknown | null = null

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
      TIME_ELAPSED_EXT: number
      GPU_DISJOINT_EXT: number
    } | null
    this.supported = ext != null
    if (!ext) {
      this.ext = null
      return
    }
    // 真实 WebGL2：query 方法在 gl 核心上；假 gl（单测）：方法在 ext 上。优先 ext，回落 gl。
    const src = (ext as Partial<TimerQueryExt>).createQuery
      ? (ext as unknown as TimerQueryExt)
      : (gl as unknown as TimerQueryExt)
    this.ext = {
      TIME_ELAPSED_EXT: ext.TIME_ELAPSED_EXT,
      GPU_DISJOINT_EXT: ext.GPU_DISJOINT_EXT,
      createQuery: () => src.createQuery(),
      deleteQuery: (q) => src.deleteQuery(q),
      beginQuery: (t, q) => src.beginQuery(t, q),
      endQuery: (t, q) => src.endQuery(t, q),
      getQueryParameter: (q, p) => src.getQueryParameter(q, p)
    }
  }

  begin(name: string): void {
    if (!this.ext) return
    const list = this.pending.get(name) ?? []
    const q = this.ext.createQuery()
    list.push(q)
    this.pending.set(name, list)
    this.activeQuery = q
    this.ext.beginQuery(this.ext.TIME_ELAPSED_EXT, q)
  }

  // name 仅为对称 API（真实 TIME_ELAPSED 单 target 同时仅一个活跃 query，不可嵌套，
  // 无需 per-name 配对；嵌套调用本身即非法用法，故不加重复 guard）。
  end(name: string): void {
    if (!this.ext) return
    if (this.activeQuery == null) return
    this.ext.endQuery(this.ext.TIME_ELAPSED_EXT, this.activeQuery)
    this.activeQuery = null
  }

  /** 包装一个可执行函数为 begin→fn→end。try/finally 保证 fn throw 时 end 仍执行（activeQuery 不卡住）。 */
  wrap<T extends unknown[]>(name: string, fn: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      this.begin(name)
      try {
        fn(...args)
      } finally {
        this.end(name)
      }
    }
  }

  /** 轮询 available drain 已就绪 query 读出 ms（ns→ms）；disjoint 置位或未就绪返回 null（不 stall）。 */
  read(name: string): number | null {
    if (!this.ext) return null
    if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      const list = this.pending.get(name)
      if (list) {
        for (const q of list) this.ext.deleteQuery(q)
        this.pending.delete(name)
      }
      return null
    }
    const list = this.pending.get(name)
    if (!list) return this.results.get(name) ?? null
    // 升序遍历 + 收集后统一删：同帧 drain 多个时让最新（数组尾）最后写入覆盖旧值。
    const remaining: unknown[] = []
    for (const q of list) {
      if (this.ext.getQueryParameter(q, QUERY_RESULT_AVAILABLE_EXT)) {
        const ns = this.ext.getQueryParameter(q, QUERY_RESULT_EXT) as number
        this.results.set(name, ns / 1e6)
        this.ext.deleteQuery(q)
      } else {
        remaining.push(q)
      }
    }
    if (remaining.length === 0) this.pending.delete(name)
    else this.pending.set(name, remaining)
    return this.results.get(name) ?? null
  }

  /** 所有已读出 stage 的 ms 快照。 */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.results)
  }
}
