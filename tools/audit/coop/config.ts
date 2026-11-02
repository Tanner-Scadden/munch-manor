// Co-op audit (tools/audit/coop.ts): what the run was asked to do (the URL, the
// players, QUICK, PICK, NET) and the bad link a page can sit behind.

import { AUDIT_PARAM } from '@game/coop/readout'

const base = process.argv[2] ?? process.env['BASE']
if (base === undefined) {
  console.error('Usage: bun tools/audit/coop.ts <game url> [players]')
  process.exit(2)
}

// NOTE: the game writes its readout of the room's World only on a page loaded
// with this param (src/coop/readout.ts), since encoding it costs every frame.
const audited = new URL(base)
audited.searchParams.set(AUDIT_PARAM, '1')
export const BASE = audited.href
export const PLAYERS = Math.min(3, Math.max(2, Number(process.argv[3] ?? 3)))
export const IS_QUICK = process.env['QUICK'] === '1'
export const [PICK_MODE, PICK_DIFFICULTY] = (process.env['PICK'] ?? '').split(
  ',',
)
export const [NET_RTT, NET_JITTER, NET_LOSS] = (process.env['NET'] ?? '')
  .split(',')
  .map(Number)

// NOTE: runs in the page before the game: every WebSocket's sends and
// messages wait half the round trip, plus jitter, plus a resend's delay
// for the lost ones (a round trip, and at least the 200 ms floor of TCP's
// retransmit timer). Each direction is one line drained by one timer, so
// nothing passes the message before it, as TCP keeps order, and what
// queued behind a lost one arrives in a burst once it does. A timer per
// message is not enough: two timers due in the same millisecond can fire
// out of order, which TCP never does, and a Delta that came before its
// base used to freeze the picture for the rest of the run.
export const slowSockets = (link: {
  readonly rttMs: number
  readonly jitterMs: number
  readonly lossPercent: number
}) => {
  const Native = window.WebSocket
  // NOTE: the bad link runs in the browser, outside any seeded game, so
  // its jitter and losses come from the page's own random numbers.
  const random = () =>
    // @effect-diagnostics-next-line globalRandom:off
    Math.random() // oxlint-disable-line no-restricted-properties
  const delay = () =>
    link.rttMs / 2 +
    random() * link.jitterMs +
    (random() * 100 < link.lossPercent ? Math.max(200, link.rttMs) : 0)
  // NOTE: one line's timer is the page's own, as the sockets it slows are.
  const later = (run: () => void, ms: number) =>
    // @effect-diagnostics-next-line globalTimers:off
    setTimeout(run, ms) // oxlint-disable-line no-restricted-globals
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
