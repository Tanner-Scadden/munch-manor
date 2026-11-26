export const slowSockets = (link: {
  readonly rttMs: number
  readonly jitterMs: number
  readonly lossPercent: number
}) => {
  const Native = window.WebSocket
  const random = () => Math.random()
  const delay = () =>
    link.rttMs / 2 +
    random() * link.jitterMs +
    (random() * 100 < link.lossPercent ? Math.max(200, link.rttMs) : 0)
  const later = (run: () => void, ms: number) => setTimeout(run, ms)
  const line = () => {
    const queue: Array<{ readonly atMs: number; readonly run: () => void }> = []
    let lastAtMs = 0
    const pump = () => {
      let next = queue[0]
      while (next !== undefined && next.atMs <= performance.now()) {
        queue.shift()
        next.run()
        next = queue[0]
      }
      if (next !== undefined) {
        later(pump, next.atMs - performance.now())
      }
    }
    return (run: () => void) => {
      lastAtMs = Math.max(lastAtMs, performance.now() + delay())
      queue.push({ atMs: lastAtMs, run })
      if (queue.length === 1) {
        later(pump, lastAtMs - performance.now())
      }
    }
  }
  const replayed = new WeakSet<Event>()
  class SlowSocket extends Native {
    private readonly outgoing = line()
    private readonly incoming = line()
    constructor(url: string | URL, protocols?: string | Array<string>) {
      super(url, protocols)
      super.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (replayed.has(event)) {
          return
        }
        event.stopImmediatePropagation()
        this.incoming(() => {
          const again = new MessageEvent('message', { data: event.data })
          replayed.add(again)
          this.dispatchEvent(again)
        })
      })
    }
    override send(data: Parameters<WebSocket['send']>[0]) {
      this.outgoing(() => {
        if (this.readyState === Native.OPEN) {
          super.send(data)
        }
      })
    }
  }
  window.WebSocket = SlowSocket
}
