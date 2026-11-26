import { Array, Clock, Option } from 'effect'

const MOST_IN_FLIGHT = 4
const NS_PER_MS = 1_000_000

const PAGE_CLOCK = Clock.Clock.defaultValue()

const pageNowMs = (): number =>
  Number(PAGE_CLOCK.monotonicTimeNanosUnsafe()) / NS_PER_MS

type Timer = Readonly<{
  gl: WebGL2RenderingContext
  timeElapsed: number
  disjoint: number
}>

const timerOf = (
  gl: Option.Option<WebGL2RenderingContext>,
): Option.Option<Timer> =>
  Option.flatMap(gl, context => {
    const extension: unknown = context.getExtension(
      'EXT_disjoint_timer_query_webgl2',
    )
    if (
      typeof extension !== 'object' ||
      extension === null ||
      !('TIME_ELAPSED_EXT' in extension) ||
      !('GPU_DISJOINT_EXT' in extension) ||
      typeof extension.TIME_ELAPSED_EXT !== 'number' ||
      typeof extension.GPU_DISJOINT_EXT !== 'number'
    ) {
      return Option.none()
    }
    return Option.some({
      gl: context,
      timeElapsed: extension.TIME_ELAPSED_EXT,
      disjoint: extension.GPU_DISJOINT_EXT,
    })
  })

export type ProbedFrame = Readonly<{
  atMs: number
  drawMs: number
  gpuMs: Option.Option<number>
}>

export class FrameProbe {
  private readonly timer: Option.Option<Timer>
  private readonly pending: Array<WebGLQuery> = []
  private current: WebGLQuery | undefined
  private startMs = 0

  constructor(gl: Option.Option<WebGL2RenderingContext>) {
    this.timer = timerOf(gl)
  }

  get hasGpuTimer(): boolean {
    return Option.isSome(this.timer)
  }

  begin(): number {
    this.startMs = pageNowMs()
    Option.map(this.timer, ({ gl, timeElapsed }) => {
      if (this.pending.length >= MOST_IN_FLIGHT) {
        return
      }
      const query = gl.createQuery()
      gl.beginQuery(timeElapsed, query)
      this.current = query
    })
    return this.startMs
  }

  end(): ProbedFrame {
    const drawMs = pageNowMs() - this.startMs
    const gpuMs = Option.flatMap(this.timer, timer => {
      if (this.current !== undefined) {
        timer.gl.endQuery(timer.timeElapsed)
        this.pending.push(this.current)
        this.current = undefined
      }
      return this.collect(timer)
    })
    return { atMs: this.startMs, drawMs, gpuMs }
  }

  private collect(timer: Timer): Option.Option<number> {
    const { gl } = timer
    const isDisjoint = gl.getParameter(timer.disjoint) === true
    let newest: Option.Option<number> = Option.none()
    while (this.pending.length > 0) {
      const [oldest] = this.pending
      if (
        oldest === undefined ||
        gl.getQueryParameter(oldest, gl.QUERY_RESULT_AVAILABLE) !== true
      ) {
        break
      }
      const elapsed: unknown = gl.getQueryParameter(oldest, gl.QUERY_RESULT)
      if (!isDisjoint && typeof elapsed === 'number') {
        newest = Option.some(elapsed / NS_PER_MS)
      }
      gl.deleteQuery(oldest)
      this.pending.shift()
    }
    return newest
  }

  destroy(): void {
    Option.map(this.timer, ({ gl }) => {
      Array.forEach(this.pending, query => {
        gl.deleteQuery(query)
      })
      if (this.current !== undefined) {
        gl.deleteQuery(this.current)
      }
    })
    this.pending.length = 0
    this.current = undefined
  }
}
