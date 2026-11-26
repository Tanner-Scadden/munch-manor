// How long the 3D world's frames take, for the quality governor
// (quality.ts): the GPU's own time for each draw where the context can time
// it (EXT_disjoint_timer_query_webgl2), and always the draw's time on the
// main thread and the page's clock at its start. Render state only: what it
// reads never reaches the Model.

import { Array, Option } from 'effect'

// NOTE: the most timer queries in flight at once; a frame that finds them
// all waiting is not timed. A result comes back a frame or two late.
const MOST_IN_FLIGHT = 4
const NS_PER_MS = 1_000_000

// NOTE: the page's clock, read for the renderer's own frame times, never by
// update or the World (src/app/subscriptions.ts reads the game's).
const pageNowMs = (): number =>
  // NOTE: the renderer times its own draws; no game state reads this.
  // oxlint-disable-next-line no-restricted-properties
  performance.now()

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
  // NOTE: the newest GPU time to come back, for some frame just before.
  gpuMs: Option.Option<number>
}>

// NOTE: mutable on purpose: it holds the GL queries in flight.
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

  // NOTE: the draw begins; the page's clock at its start.
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

  // NOTE: the queries come back in order; a disjoint GPU (its clock reset,
  // the page put away) spoils every one in flight.
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
