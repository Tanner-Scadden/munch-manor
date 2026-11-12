import { Array, Function, Option, Result, pipe } from 'effect'

import {
  type ClientNet,
  arrivedOff,
  emptyClientNet,
  recordSample,
} from './NetStats'
import {
  type ClientFrame,
  type ClosedReason,
  MAX_RTT_MS,
  MAX_SAMPLES_PER_INPUT,
  MAX_TICKS_PER_SAMPLE,
  NEUTRAL_INPUT,
  type PlayerInput,
  type RefusedReason,
  type Sample,
  ServerFrame,
  inputsEqual,
} from './Protocol'
import { TICK_MS } from './Room'
import { type WireError, readAll } from './Wire'
import type { World } from './World'

// NOTE: a player's side of the room, as pure functions over plain data, so
// it is tested without a socket and fits a Foldkit Model: the shell feeds
// it what arrives (`receive`) and, once a frame, the local input
// (`tickInput`), sends what it returns, and draws `render`.
//
// - Clock. The room's tick now is estimated from the newest message's tick,
//   the time it arrived, and half the round trip.
// - Input. The local input runs on "input ticks", ahead of the room's tick
//   by half a round trip and a margin, so a sample reaches the room in time
//   for its tick. Samples collect as runs of one input and go out as an
//   Input when the input changes (at most every INPUT_INTERVAL_MS) or as a
//   heartbeat every HEARTBEAT_MS.
// - Prediction. Your own player runs at once from local input. Each message
//   from the room carries your authoritative player as of its tick; the
//   session puts that back, replays the inputs of later ticks on top, and
//   the shown copy eases to the result, or snaps when far off.
// - Interpolation. Everyone else is drawn INTERPOLATION_MS behind the
//   room's clock, between the two messages around that moment.

export const INTERPOLATION_MS = 100
// NOTE: how far behind everyone else is drawn adapts to how unevenly the
// room's messages arrive: a steady link draws as little as MIN behind,
// a jittery one up to MAX, so a late message rarely leaves nothing to
// draw (MULTIPLAYER.md, "Latency").
export const MIN_INTERPOLATION_MS = 70
export const MAX_INTERPOLATION_MS = 200
const SEND_INTERVAL_MS = 50
const JITTER_SPAN = 2.5
const JITTER_EASE = 0.1
const DELAY_EASE = 0.05
export const INPUT_INTERVAL_MS = 100
export const HEARTBEAT_MS = 1000
export const PING_EVERY_MS = 2000
export const INPUT_MARGIN_MS = 2 * TICK_MS
export const SNAP_DISTANCE = 48
export const EASE_MS = 80
export const KEEP_FRAMES_MS = 1000
// NOTE: the room sends 20 times a second, so a gap this long is a stall.
export const STALL_MS = 200
export const MAX_PREDICTED_TICKS = 30

export type SessionPhase =
  | { readonly _tag: 'Connecting' }
  | { readonly _tag: 'Waiting' }
  | { readonly _tag: 'Playing' }
  | { readonly _tag: 'Ended'; readonly reason: ClosedReason }
  | { readonly _tag: 'Refused'; readonly reason: RefusedReason }
  | { readonly _tag: 'Kicked' }

export interface Received<W> {
  readonly tick: number
  readonly world: W
  readonly atMs: number
}

export interface Anchor {
  readonly tick: number
  readonly atMs: number
}

export interface Ping {
  readonly nonce: number
  readonly sentMs: number
}

export interface Stats {
  readonly bytesIn: number
  readonly framesIn: number
  readonly bytesOut: number
  readonly framesOut: number
  readonly inputsOut: number
  readonly corrections: number
  readonly lastCorrectionPx: number
  readonly maxCorrectionPx: number
  // NOTE: times a message could not be applied (a Delta with no world for
  // its base, or one that did not decode), so the session asked the room
  // for a fresh Snapshot.
  readonly resyncs: number
  // NOTE: gaps with nothing from the room for at least STALL_MS, such as
  // a lost TCP segment's resend holding everything behind it, and the
  // longest of them.
  readonly stalls: number
  readonly longestStallMs: number
  readonly sinceMs: number
  // NOTE: the run's network numbers for its summary, started afresh by
  // `startRunTally` when a run starts in the room.
  readonly net: ClientNet
}

export interface Session<W, Own> {
  readonly phase: SessionPhase
  readonly slot: Option.Option<number>
  readonly frames: ReadonlyArray<Received<W>>
  readonly ack: number
  readonly anchor: Option.Option<Anchor>
  readonly rttMs: number
  readonly away: ReadonlyArray<number>
  readonly inputTick: number
  readonly history: ReadonlyArray<{
    readonly tick: number
    readonly input: PlayerInput
  }>
  readonly predicted: Option.Option<Own>
  readonly shown: Option.Option<Own>
  readonly jitterMs: number
  readonly interpolationMs: number
  readonly lastArrival: Option.Option<Anchor>
  readonly rtts: ReadonlyArray<{
    readonly slot: number
    readonly rttMs: number
  }>
  readonly renderedMs: number
  readonly seq: number
  readonly samples: ReadonlyArray<Sample>
  readonly samplesFrom: number
  readonly sentInput: PlayerInput
  readonly sentMs: number
  readonly pings: ReadonlyArray<Ping>
  readonly nextNonce: number
  readonly pingedMs: number
  // NOTE: a message did not apply, so every Delta after it would not
  // either. Until a Snapshot comes (the shell reconnects for one), Deltas
  // are set aside instead of failing one by one.
  readonly isResyncing: boolean
  readonly heardMs: number
  readonly stats: Stats
}

const CONNECTING: SessionPhase = { _tag: 'Connecting' }

export const makeSession = <W, Own>(nowMs: number): Session<W, Own> => ({
  phase: CONNECTING,
  slot: Option.none(),
  frames: [],
  ack: 0,
  anchor: Option.none(),
  rttMs: 0,
  away: [],
  inputTick: 0,
  history: [],
  predicted: Option.none(),
  shown: Option.none(),
  jitterMs: 0,
  interpolationMs: INTERPOLATION_MS,
  lastArrival: Option.none(),
  rtts: [],
  renderedMs: nowMs,
  seq: 0,
  samples: [],
  samplesFrom: 0,
  sentInput: NEUTRAL_INPUT,
  sentMs: nowMs,
  pings: [],
  nextNonce: 1,
  pingedMs: nowMs - PING_EVERY_MS,
  isResyncing: false,
  heardMs: nowMs,
  stats: {
    bytesIn: 0,
    framesIn: 0,
    bytesOut: 0,
    framesOut: 0,
    inputsOut: 0,
    corrections: 0,
    lastCorrectionPx: 0,
    maxCorrectionPx: 0,
    resyncs: 0,
    stalls: 0,
    longestStallMs: 0,
    sinceMs: nowMs,
    net: emptyClientNet,
  },
})

// NOTE: a new socket. What it learns starts over; the counters do not. A
// link that had been made and dropped is a reconnect; another try while
// still connecting is not.
export const reconnecting: {
  <W, Own>(nowMs: number): (session: Session<W, Own>) => Session<W, Own>
  <W, Own>(session: Session<W, Own>, nowMs: number): Session<W, Own>
} = Function.dual(
  2,
  <W, Own>(session: Session<W, Own>, nowMs: number): Session<W, Own> => ({
    ...makeSession<W, Own>(nowMs),
    rttMs: session.rttMs,
    stats:
      session.phase._tag === 'Connecting'
        ? session.stats
        : {
            ...session.stats,
            net: {
              ...session.stats.net,
              reconnects: session.stats.net.reconnects + 1,
            },
          },
  }),
)

// NOTE: a run starts in the room (its Welcome at tick 0), so its network
// numbers start from nothing: the lobby's pings and an earlier run in the
// same room are not this run's.
export const startRunTally = <W, Own>(
  session: Session<W, Own>,
): Session<W, Own> => ({
  ...session,
  stats: { ...session.stats, net: emptyClientNet },
})

// CLOCK

export const roomTickAt: {
  (nowMs: number): (session: Session<unknown, unknown>) => number
  (session: Session<unknown, unknown>, nowMs: number): number
} = Function.dual(
  2,
  (session: Session<unknown, unknown>, nowMs: number): number =>
    Option.match(session.anchor, {
      onNone: () => 0,
      onSome: anchor => anchor.tick + (nowMs - anchor.atMs) / TICK_MS,
    }),
)

// NOTE: a message with tick T arriving now says the room is at about T plus
// half a round trip. Small differences are eased in so the clock does not
// jitter with the network. A message far ahead of the clock jumps it
// forward. One far behind is only late (a lost segment's resend held it
// and everything behind it), so it is eased in like a small one: jumping
// back would rewind everyone drawn and stop your own inputs until the
// clock passed them again. Only a clock a long way ahead jumps back.
const JUMP_TICKS = 6
const JUMP_BACK_TICKS = 60
const EASE_CLOCK = 0.1

const reanchor = <W, Own>(
  session: Session<W, Own>,
  tick: number,
  nowMs: number,
): Session<W, Own> => {
  const heard = tick + session.rttMs / 2 / TICK_MS
  const anchor = Option.match(session.anchor, {
    onNone: () => ({ tick: heard, atMs: nowMs }),
    onSome: () => {
      const believed = roomTickAt(session, nowMs)
      return heard - believed > JUMP_TICKS || believed - heard > JUMP_BACK_TICKS
        ? { tick: heard, atMs: nowMs }
        : { tick: believed + (heard - believed) * EASE_CLOCK, atMs: nowMs }
    },
  })
  return { ...session, anchor: Option.some(anchor) }
}

export const inputTickAt: {
  (nowMs: number): (session: Session<unknown, unknown>) => number
  (session: Session<unknown, unknown>, nowMs: number): number
} = Function.dual(
  2,
  (session: Session<unknown, unknown>, nowMs: number): number =>
    Math.floor(
      roomTickAt(session, nowMs) +
        (session.rttMs / 2 + INPUT_MARGIN_MS) / TICK_MS,
    ),
)

// RECEIVING

const keepRecent = <W>(
  frames: ReadonlyArray<Received<W>>,
): ReadonlyArray<Received<W>> =>
  Option.match(Array.last(frames), {
    onNone: () => frames,
    onSome: newest =>
      Array.filter(
        frames,
        frame => frame.tick >= newest.tick - KEEP_FRAMES_MS / TICK_MS,
      ),
  })

// NOTE: a move this small is rounding, not a correction.
const CORRECTION_PX = 0.5

// NOTE: the room's word on your player as of `tick`, with your inputs of
// later ticks replayed on top.
const reconcile = <W, Own>(
  world: World<W, Own>,
  session: Session<W, Own>,
  received: Received<W>,
): Session<W, Own> =>
  Option.match(
    Option.flatMap(session.slot, slot => world.own.of(received.world, slot)),
    {
      onNone: () => ({
        ...session,
        predicted: Option.none(),
        shown: Option.none(),
      }),
      onSome: authoritative => {
        const later = Array.filter(
          session.history,
          entry => entry.tick > received.tick,
        )
        const replayed = Array.reduce(later, authoritative, (own, entry) =>
          world.own.step(own, entry.input, received.world),
        )
        const gap = Option.match(session.predicted, {
          onNone: () => 0,
          onSome: predicted => world.own.gap(predicted, replayed),
        })
        const shown = Option.match(session.shown, {
          onNone: () => replayed,
          onSome: current =>
            world.own.gap(current, replayed) > SNAP_DISTANCE
              ? replayed
              : current,
        })
        return {
          ...session,
          history: later,
          predicted: Option.some(replayed),
          shown: Option.some(shown),
          stats: {
            ...session.stats,
            corrections:
              session.stats.corrections + (gap > CORRECTION_PX ? 1 : 0),
            lastCorrectionPx: gap,
            maxCorrectionPx: Math.max(session.stats.maxCorrectionPx, gap),
            net: {
              ...session.stats.net,
              corrections:
                session.stats.net.corrections + (gap > CORRECTION_PX ? 1 : 0),
              correctionMaxPx: Math.max(session.stats.net.correctionMaxPx, gap),
            },
          },
        }
      },
    },
  )

const counted = <W, Own>(
  session: Session<W, Own>,
  bytes: number,
  nowMs: number,
): Session<W, Own> => {
  const gapMs = nowMs - session.heardMs
  const isStall = session.stats.framesIn > 0 && gapMs >= STALL_MS
  return {
    ...session,
    heardMs: nowMs,
    stats: {
      ...session.stats,
      bytesIn: session.stats.bytesIn + bytes,
      framesIn: session.stats.framesIn + 1,
      stalls: session.stats.stalls + (isStall ? 1 : 0),
      longestStallMs: isStall
        ? Math.max(session.stats.longestStallMs, gapMs)
        : session.stats.longestStallMs,
    },
  }
}

// NOTE: a message that cannot apply. Over TCP every Delta follows its
// base, so this is a bug or a corrupt frame, not the network: the session
// sets Deltas aside and the shell reconnects for a Snapshot, instead of
// the picture freezing for the rest of the run.
const needsResync = <W, Own>(session: Session<W, Own>): Session<W, Own> =>
  session.isResyncing
    ? session
    : {
        ...session,
        isResyncing: true,
        stats: { ...session.stats, resyncs: session.stats.resyncs + 1 },
      }

const startPlaying = <W, Own>(
  session: Session<W, Own>,
  nowMs: number,
): Session<W, Own> => ({
  ...session,
  inputTick: inputTickAt(session, nowMs),
  samples: [],
  samplesFrom: inputTickAt(session, nowMs) + 1,
  history: [],
})

const PLAYING: SessionPhase = { _tag: 'Playing' }
const WAITING: SessionPhase = { _tag: 'Waiting' }

export const receive: {
  <W, Own>(
    session: Session<W, Own>,
    frame: ServerFrame,
    bytes: number,
    nowMs: number,
  ): (world: World<W, Own>) => Result.Result<Session<W, Own>, WireError>
  <W, Own>(
    world: World<W, Own>,
    session: Session<W, Own>,
    frame: ServerFrame,
    bytes: number,
    nowMs: number,
  ): Result.Result<Session<W, Own>, WireError>
} = Function.dual(
  5,
  <W, Own>(
    world: World<W, Own>,
    session: Session<W, Own>,
    frame: ServerFrame,
    bytes: number,
    nowMs: number,
  ): Result.Result<Session<W, Own>, WireError> => {
    const heard = counted(session, bytes, nowMs)
    const ok = (
      next: Session<W, Own>,
    ): Result.Result<Session<W, Own>, WireError> => Result.succeed(next)
    return ServerFrame.match(frame, {
      Welcome: welcome =>
        ok({
          ...heard,
          phase: welcome.state === 'Playing' ? PLAYING : WAITING,
          slot: Option.some(welcome.slot),
          seq: 0,
          ack: 0,
          frames: [],
          away: [],
        }),
      Refused: refused =>
        ok({
          ...heard,
          phase: { _tag: 'Refused', reason: refused.reason },
        }),
      Snapshot: snapshot =>
        Result.match(readAll(snapshot.world, world.readSnapshot), {
          onFailure: () => ok(needsResync(heard)),
          onSuccess: read => {
            const received = { tick: snapshot.tick, world: read, atMs: nowMs }
            const anchored = reanchor(
              {
                ...heard,
                phase: PLAYING,
                ack: snapshot.ack,
                frames: [received],
                lastArrival: Option.some({ tick: snapshot.tick, atMs: nowMs }),
                isResyncing: false,
              },
              snapshot.tick,
              nowMs,
            )
            return ok(
              reconcile(
                world,
                {
                  ...startPlaying(anchored, nowMs),
                  predicted: Option.none(),
                  shown: Option.none(),
                },
                received,
              ),
            )
          },
        }),
      Delta: delta =>
        heard.isResyncing
          ? ok(heard)
          : pipe(
              Array.findFirst(heard.frames, held => held.tick === delta.base),
              Option.flatMap(base =>
                Result.getSuccess(
                  readAll(delta.diff, reader =>
                    world.applyDiff(reader, base.world),
                  ),
                ),
              ),
              Option.match({
                onNone: () => ok(needsResync(heard)),
                onSome: read => {
                  const received = {
                    tick: delta.tick,
                    world: read,
                    atMs: nowMs,
                  }
                  const anchored = reanchor(
                    {
                      ...arrived(heard, delta.tick, nowMs),
                      ack: delta.ack,
                      rtts: Array.isReadonlyArrayEmpty(delta.pings)
                        ? heard.rtts
                        : delta.pings,
                      frames: keepRecent(Array.append(heard.frames, received)),
                    },
                    delta.tick,
                    nowMs,
                  )
                  return ok(reconcile(world, anchored, received))
                },
              }),
            ),
      Pong: pong =>
        ok(
          Option.match(
            Array.findFirst(heard.pings, ping => ping.nonce === pong.nonce),
            {
              onNone: () => heard,
              onSome: ping => {
                const sample = nowMs - ping.sentMs
                const rttMs =
                  heard.rttMs === 0
                    ? sample
                    : heard.rttMs * 0.75 + sample * 0.25
                return {
                  ...heard,
                  rttMs,
                  stats: withRttSample(heard.stats, sample),
                  pings: Array.filter(
                    heard.pings,
                    other => other.nonce !== pong.nonce,
                  ),
                }
              },
            },
          ),
        ),
      Away: away =>
        ok({
          ...heard,
          away: Array.dedupe(Array.append(heard.away, away.slot)),
        }),
      Back: back =>
        ok({
          ...heard,
          away: Array.filter(heard.away, slot => slot !== back.slot),
        }),
      Kicked: () => ok({ ...heard, phase: { _tag: 'Kicked' } }),
      RoomClosed: closed =>
        ok({
          ...heard,
          phase: { _tag: 'Ended', reason: closed.reason },
          predicted: Option.none(),
          shown: Option.none(),
        }),
    })
  },
)

// SENDING

const appendSample = (
  samples: ReadonlyArray<Sample>,
  input: PlayerInput,
): ReadonlyArray<Sample> =>
  Option.match(Array.last(samples), {
    onSome: last =>
      inputsEqual(last.input, input) && last.ticks < MAX_TICKS_PER_SAMPLE
        ? Array.append(Array.dropRight(samples, 1), {
            ticks: last.ticks + 1,
            input,
          })
        : Array.append(samples, { ticks: 1, input }),
    onNone: () => [{ ticks: 1, input }],
  })

const hasChange = (session: Session<unknown, unknown>): boolean =>
  Array.some(
    session.samples,
    sample => !inputsEqual(sample.input, session.sentInput),
  )

export interface Ticked<W, Own> {
  readonly session: Session<W, Own>
  readonly outgoing: ReadonlyArray<ClientFrame>
}

// NOTE: once a frame, with the input the player holds now. It runs your
// player forward to the input tick due now, records the samples, and says
// what to send. Nothing runs or goes out unless a game is on.
export const tickInput: {
  <W, Own>(
    session: Session<W, Own>,
    input: PlayerInput,
    nowMs: number,
  ): (world: World<W, Own>) => Ticked<W, Own>
  <W, Own>(
    world: World<W, Own>,
    session: Session<W, Own>,
    input: PlayerInput,
    nowMs: number,
  ): Ticked<W, Own>
} = Function.dual(
  4,
  <W, Own>(
    world: World<W, Own>,
    session: Session<W, Own>,
    input: PlayerInput,
    nowMs: number,
  ): Ticked<W, Own> => {
    if (session.phase._tag !== 'Playing' || Option.isNone(session.anchor)) {
      return { session, outgoing: [] }
    }
    const target = inputTickAt(session, nowMs)
    const from = Math.max(session.inputTick, target - MAX_PREDICTED_TICKS)
    const ticks = Array.range(from + 1, Math.max(from + 1, target))
    const due = target > session.inputTick ? ticks : []
    const newest = Option.map(Array.last(session.frames), frame => frame.world)
    const predictedThrough = Array.reduce(due, session, (current, tick) => ({
      ...current,
      inputTick: tick,
      samples: appendSample(current.samples, input),
      samplesFrom: Array.isReadonlyArrayEmpty(current.samples)
        ? tick
        : current.samplesFrom,
      predicted: Option.flatMap(current.predicted, own =>
        Option.map(newest, latest => world.own.step(own, input, latest)),
      ),
    }))
    // NOTE: the history grows by the due ticks at once, not one copy a tick.
    const stepped = Array.isReadonlyArrayEmpty(due)
      ? predictedThrough
      : {
          ...predictedThrough,
          history: Array.appendAll(
            session.history,
            Array.map(due, tick => ({ tick, input })),
          ),
        }
    const sinceSent = nowMs - stepped.sentMs
    const wantsInput =
      Array.isReadonlyArrayNonEmpty(stepped.samples) &&
      ((hasChange(stepped) && sinceSent >= INPUT_INTERVAL_MS) ||
        sinceSent >= HEARTBEAT_MS ||
        stepped.samples.length >= MAX_SAMPLES_PER_INPUT)
    const withInput: Ticked<W, Own> = wantsInput
      ? {
          session: {
            ...stepped,
            seq: stepped.seq + 1,
            samples: [],
            samplesFrom: stepped.inputTick + 1,
            sentInput: input,
            sentMs: nowMs,
            stats: { ...stepped.stats, inputsOut: stepped.stats.inputsOut + 1 },
          },
          outgoing: [
            {
              _tag: 'Input',
              seq: stepped.seq + 1,
              tick: stepped.samplesFrom,
              seen: Math.max(0, Math.floor(viewTickAt(stepped, nowMs))),
              rttMs: Math.min(MAX_RTT_MS, Math.round(stepped.rttMs)),
              samples: stepped.samples,
            },
          ],
        }
      : { session: stepped, outgoing: [] }
    return withInput
  },
)

const withRttSample = (stats: Stats, sampleMs: number): Stats => ({
  ...stats,
  net: { ...stats.net, rtt: recordSample(stats.net.rtt, sampleMs) },
})

// NOTE: the round trip comes from the socket's free ping (a text ping the
// room's Durable Object answers by itself, never billed and never waking
// it), not from a message the room is billed for. `sentMs` is when it went.
export const heardPong: {
  <W, Own>(
    sentMs: number,
    nowMs: number,
  ): (session: Session<W, Own>) => Session<W, Own>
  <W, Own>(
    session: Session<W, Own>,
    sentMs: number,
    nowMs: number,
  ): Session<W, Own>
} = Function.dual(
  3,
  <W, Own>(
    session: Session<W, Own>,
    sentMs: number,
    nowMs: number,
  ): Session<W, Own> => {
    const sample = Math.max(0, nowMs - sentMs)
    return {
      ...session,
      rttMs:
        session.rttMs === 0 ? sample : session.rttMs * 0.75 + sample * 0.25,
      stats: withRttSample(session.stats, sample),
    }
  },
)

// NOTE: a message's arrival against when its tick says it should arrive:
// the spread is the jitter, and the delay to draw behind eases toward it.
const arrived = <W, Own>(
  session: Session<W, Own>,
  tick: number,
  nowMs: number,
): Session<W, Own> =>
  Option.match(session.lastArrival, {
    onNone: () => ({
      ...session,
      lastArrival: Option.some({ tick, atMs: nowMs }),
    }),
    onSome: last => {
      const expected = (tick - last.tick) * TICK_MS
      const signedOff = nowMs - last.atMs - expected
      const off = Math.abs(signedOff)
      const jitterMs = session.jitterMs + (off - session.jitterMs) * JITTER_EASE
      const target = Math.max(
        MIN_INTERPOLATION_MS,
        Math.min(
          MAX_INTERPOLATION_MS,
          SEND_INTERVAL_MS + JITTER_SPAN * jitterMs,
        ),
      )
      return {
        ...session,
        jitterMs,
        stats: {
          ...session.stats,
          net: arrivedOff(session.stats.net, signedOff),
        },
        interpolationMs:
          session.interpolationMs +
          (target - session.interpolationMs) * DELAY_EASE,
        lastArrival: Option.some({ tick, atMs: nowMs }),
      }
    },
  })

// NOTE: the room tick this client draws everyone else at now.
export const viewTickAt: {
  (nowMs: number): (session: Session<unknown, unknown>) => number
  (session: Session<unknown, unknown>, nowMs: number): number
} = Function.dual(
  2,
  (session: Session<unknown, unknown>, nowMs: number): number =>
    roomTickAt(session, nowMs) - session.interpolationMs / TICK_MS,
)

export const countSent: {
  <W, Own>(bytes: number): (session: Session<W, Own>) => Session<W, Own>
  <W, Own>(session: Session<W, Own>, bytes: number): Session<W, Own>
} = Function.dual(
  2,
  <W, Own>(session: Session<W, Own>, bytes: number): Session<W, Own> => ({
    ...session,
    stats: {
      ...session.stats,
      bytesOut: session.stats.bytesOut + bytes,
      framesOut: session.stats.framesOut + 1,
    },
  }),
)

// RENDERING

export interface Rendered<W, Own> {
  readonly session: Session<W, Own>
  readonly world: Option.Option<W>
  readonly renderTick: number
}

const bracket = <W>(
  frames: ReadonlyArray<Received<W>>,
  tick: number,
): Option.Option<readonly [Received<W>, Received<W>]> =>
  pipe(
    Array.zip(frames, Array.drop(frames, 1)),
    Array.findFirst(([from, to]) => from.tick <= tick && tick <= to.tick),
  )

// NOTE: the world to draw now: everyone INTERPOLATION_MS behind the room's
// clock (held at the newest message if the next is late), with your own
// player where you predicted it, eased.
export const render: {
  <W, Own>(
    session: Session<W, Own>,
    nowMs: number,
  ): (world: World<W, Own>) => Rendered<W, Own>
  <W, Own>(
    world: World<W, Own>,
    session: Session<W, Own>,
    nowMs: number,
  ): Rendered<W, Own>
} = Function.dual(
  3,
  <W, Own>(
    world: World<W, Own>,
    session: Session<W, Own>,
    nowMs: number,
  ): Rendered<W, Own> => {
    const renderTick = viewTickAt(session, nowMs)
    const others = Option.map(Array.last(session.frames), newest =>
      Option.match(bracket(session.frames, renderTick), {
        onNone: () =>
          Option.match(Array.head(session.frames), {
            onNone: () => newest.world,
            onSome: oldest =>
              renderTick < oldest.tick ? oldest.world : newest.world,
          }),
        onSome: ([from, to]) =>
          to.tick === from.tick
            ? to.world
            : world.interpolate(
                from.world,
                to.world,
                (renderTick - from.tick) / (to.tick - from.tick),
              ),
      }),
    )
    const ease = Math.min(
      1,
      Math.max(0, (nowMs - session.renderedMs) / EASE_MS),
    )
    const shown = Option.flatMap(session.shown, current =>
      Option.map(session.predicted, predicted =>
        world.own.blend(current, predicted, ease),
      ),
    )
    return {
      session: { ...session, shown, renderedMs: nowMs },
      world: Option.map(others, drawn =>
        Option.match(Option.all([session.slot, shown]), {
          onNone: () => drawn,
          onSome: ([slot, own]) => world.own.put(drawn, slot, own),
        }),
      ),
      renderTick,
    }
  },
)
