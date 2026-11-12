import { Array, Function, Match, Number, Option, Order, pipe } from 'effect'

import type { Hold } from '../../src/app/model'
import {
  FADE_MAX_MS,
  PACK_WARNING_MS,
  QUIET_HURRY_MS,
  RELAX_QUIET_MAX_MS,
  RELAX_TRICKLE_MAX,
  ZOMBIE_ALIVE_MAX,
} from '../../src/shared/constants'
import { BOSS_RULES } from '../../src/world/zombies/bossRules'
import type { Assumptions } from './modelAssumptions'

// THE WAVE AS A FLOW

export type FlowRules = Readonly<{
  stepMs: number
  aliveCap: number
  fadeMaxMs: number
  quietHurryMs: number
  relaxQuietMaxMs: number
  trickleMax: number
  packWarningMs: number
  bossEntranceMs: number
  bossHoldMs: number
  maxWaveMs: number
}>

export const flowRules = (assumptions: Assumptions): FlowRules => ({
  stepMs: assumptions.stepMs,
  aliveCap: ZOMBIE_ALIVE_MAX,
  fadeMaxMs: FADE_MAX_MS,
  quietHurryMs: QUIET_HURRY_MS,
  relaxQuietMaxMs: RELAX_QUIET_MAX_MS,
  trickleMax: RELAX_TRICKLE_MAX,
  packWarningMs: PACK_WARNING_MS,
  bossEntranceMs: BOSS_RULES.entranceMs,
  bossHoldMs: BOSS_RULES.holdMs,
  maxWaveMs: assumptions.maxWaveMs,
})

// NOTE: a Straggler is a lone Shambler, Runner, or Kaboomer, the kind a
// quiet relax may pull in early, as the trickle in src/world/waves/pacing.ts does.
export type Arrival = 'Straggler' | 'Pack'

export type Incoming = Readonly<{ atMs: number; hp: number; arrival: Arrival }>

export type FlowBoss =
  | Readonly<{ _tag: 'Absent' }>
  | Readonly<{ _tag: 'Waiting'; waitBelow: number; hp: number }>

type BossStage =
  | Readonly<{ _tag: 'Absent' }>
  | Readonly<{ _tag: 'Waiting'; waitBelow: number; hp: number }>
  | Readonly<{ _tag: 'Arriving'; remainingMs: number; hp: number }>
  | Readonly<{ _tag: 'Fighting'; standingMs: number }>

type Beat =
  | Readonly<{ _tag: 'Flowing' }>
  | Readonly<{
      _tag: 'Fading'
      releaseBelow: number
      relaxMs: number
      waitedMs: number
    }>
  | Readonly<{ _tag: 'Resting'; remainingMs: number; trickled: number }>

type Flow = Readonly<{
  wallMs: number
  clockMs: number
  pending: ReadonlyArray<Incoming>
  alive: ReadonlyArray<number>
  holds: ReadonlyArray<Hold>
  beat: Beat
  quietMs: number
  boss: BossStage
  arrivedHp: number
  emptyMs: number
  peakAlive: number
}>

type Step = Readonly<{ arrivedHp: number; alive: number }>

const FLOWING: Beat = { _tag: 'Flowing' }

const byArrival = Order.mapInput(Order.Number, ({ atMs }: Incoming) => atMs)

const drain = (
  alive: ReadonlyArray<number>,
  damage: number,
): ReadonlyArray<number> =>
  pipe(
    Array.reduce(
      alive,
      { left: damage, standing: Array.empty<number>() },
      ({ left, standing }, hp) =>
        hp > left
          ? { left: 0, standing: Array.append(standing, hp - left) }
          : { left: left - hp, standing },
    ),
    ({ standing }) => standing,
  )

const isHeldByBoss = (boss: BossStage, rules: FlowRules): boolean =>
  boss._tag === 'Arriving' ||
  (boss._tag === 'Fighting' && boss.standingMs < rules.bossHoldMs)

type BossStep = Readonly<{ boss: BossStage; arrives: Option.Option<number> }>

const advanceBoss = (
  boss: BossStage,
  pendingCount: number,
  rules: FlowRules,
): BossStep =>
  Match.valueTags(boss, {
    Absent: (absent): BossStep => ({ boss: absent, arrives: Option.none() }),
    Waiting: (waiting): BossStep =>
      pendingCount <= waiting.waitBelow
        ? {
            boss: {
              _tag: 'Arriving',
              remainingMs: rules.bossEntranceMs,
              hp: waiting.hp,
            },
            arrives: Option.none(),
          }
        : { boss: waiting, arrives: Option.none() },
    Arriving: (arriving): BossStep =>
      arriving.remainingMs <= rules.stepMs
        ? {
            boss: { _tag: 'Fighting', standingMs: 0 },
            arrives: Option.some(arriving.hp),
          }
        : {
            boss: {
              ...arriving,
              remainingMs: arriving.remainingMs - rules.stepMs,
            },
            arrives: Option.none(),
          },
    Fighting: (fighting): BossStep => ({
      boss: { ...fighting, standingMs: fighting.standingMs + rules.stepMs },
      arrives: Option.none(),
    }),
  })

type Clock = Readonly<{
  clockMs: number
  beat: Beat
  holds: ReadonlyArray<Hold>
  pending: ReadonlyArray<Incoming>
}>

// NOTE: a quiet relax pulls the soonest straggler in now, up to trickleMax,
// then ends, as the trickle in src/world/waves/pacing.ts does.
const trickled = (
  flow: Flow,
  beat: Readonly<{ _tag: 'Resting'; remainingMs: number; trickled: number }>,
  rules: FlowRules,
): Clock => {
  const { clockMs, holds, pending } = flow
  const at = Array.findFirstIndex(
    pending,
    ({ arrival }) => arrival === 'Straggler',
  )
  return pipe(
    at,
    Option.filter(() => beat.trickled < rules.trickleMax),
    Option.flatMap(index =>
      Option.map(Array.get(pending, index), straggler => ({
        index,
        straggler,
      })),
    ),
    Option.match({
      onNone: () => ({ clockMs, holds, pending, beat: FLOWING }),
      onSome: ({ index, straggler }) => ({
        clockMs,
        holds,
        pending: Array.prepend(Array.remove(pending, index), {
          ...straggler,
          atMs: clockMs,
        }),
        beat: { ...beat, trickled: beat.trickled + 1 },
      }),
    }),
  )
}

const advanceClock = (flow: Flow, waiting: number, rules: FlowRules): Clock => {
  const { beat, clockMs, holds, pending } = flow
  return Match.valueTags(beat, {
    Fading: (fading): Clock => {
      const waitedMs = fading.waitedMs + rules.stepMs
      const isThin = waiting === 0 && flow.alive.length < fading.releaseBelow
      return {
        clockMs,
        holds,
        pending,
        beat:
          isThin || waitedMs >= rules.fadeMaxMs
            ? { _tag: 'Resting', remainingMs: fading.relaxMs, trickled: 0 }
            : { ...fading, waitedMs },
      }
    },
    Resting: (resting): Clock => {
      if (flow.quietMs >= rules.relaxQuietMaxMs) {
        return trickled(flow, resting, rules)
      }
      const remainingMs = resting.remainingMs - rules.stepMs
      return {
        clockMs,
        holds,
        pending,
        beat: remainingMs <= 0 ? FLOWING : { ...resting, remainingMs },
      }
    },
    Flowing: (): Clock => {
      const worldMs = isHeldByBoss(flow.boss, rules) ? 0 : rules.stepMs
      return Option.match(Array.head(holds), {
        onNone: () => ({ clockMs: clockMs + worldMs, beat, holds, pending }),
        onSome: (hold): Clock =>
          hold.atMs <= clockMs + worldMs
            ? {
                clockMs: Math.max(clockMs, hold.atMs),
                holds: Array.drop(holds, 1),
                pending,
                beat: {
                  _tag: 'Fading',
                  releaseBelow: hold.releaseBelow,
                  relaxMs: hold.relaxMs,
                  waitedMs: 0,
                },
              }
            : { clockMs: clockMs + worldMs, beat, holds, pending },
      })
    },
  })
}

// NOTE: after a quiet stretch the wave clock skips to the next pack's
// warning, never past a hold, as QUIET_HURRY_MS does in src/world/waves/pacing.ts.
const hurried = (flow: Flow, rules: FlowRules): number =>
  flow.beat._tag === 'Flowing' && flow.quietMs >= rules.quietHurryMs
    ? pipe(
        Array.head(flow.pending),
        Option.map(next => next.atMs - rules.packWarningMs),
        Option.map(skipTo =>
          Option.match(Array.head(flow.holds), {
            onNone: () => skipTo,
            onSome: hold => Math.min(skipTo, hold.atMs),
          }),
        ),
        Option.match({
          onNone: () => flow.clockMs,
          onSome: skipTo => Math.max(flow.clockMs, skipTo),
        }),
      )
    : flow.clockMs

const isOver = (flow: Flow, rules: FlowRules): boolean =>
  flow.wallMs >= rules.maxWaveMs ||
  (Array.isReadonlyArrayEmpty(flow.pending) &&
    Array.isReadonlyArrayEmpty(flow.alive) &&
    (flow.boss._tag === 'Absent' || flow.boss._tag === 'Fighting'))

const stepFlow = (flow: Flow, dps: number, rules: FlowRules): Flow => {
  const standing = drain(flow.alive, (dps * rules.stepMs) / 1000)
  const bossMove = advanceBoss(flow.boss, flow.pending.length, rules)
  const bossArrived = Option.getOrElse(bossMove.arrives, () => 0)
  const withBoss = Option.match(bossMove.arrives, {
    onNone: () => standing,
    onSome: hp => Array.append(standing, hp),
  })
  const [dueBefore] = Array.span(
    flow.pending,
    ({ atMs }) => atMs <= flow.clockMs,
  )
  const clock = advanceClock(
    { ...flow, alive: withBoss, boss: bossMove.boss },
    dueBefore.length,
    rules,
  )
  const clockMs = hurried({ ...flow, ...clock, alive: withBoss }, rules)
  const [due, later] = Array.span(clock.pending, ({ atMs }) => atMs <= clockMs)
  const room = Math.max(0, rules.aliveCap - withBoss.length)
  const [admitted, waiting] = Array.splitAt(due, room)
  const arrivedHp =
    Number.sumAll(Array.map(admitted, ({ hp }) => hp)) + bossArrived
  const alive = Array.appendAll(
    withBoss,
    Array.map(admitted, ({ hp }) => hp),
  )
  const pending = Array.appendAll(waiting, later)
  const isAnnounced = pipe(
    Array.head(pending),
    Option.exists(next => next.atMs - clockMs <= rules.packWarningMs),
  )
  const isQuiet =
    Array.isReadonlyArrayEmpty(alive) && waiting.length === 0 && !isAnnounced
  return {
    ...clock,
    clockMs,
    wallMs: flow.wallMs + rules.stepMs,
    pending,
    alive,
    boss: bossMove.boss,
    quietMs: isQuiet ? flow.quietMs + rules.stepMs : 0,
    arrivedHp,
    emptyMs:
      flow.emptyMs + (Array.isReadonlyArrayEmpty(alive) ? rules.stepMs : 0),
    peakAlive: Math.max(flow.peakAlive, alive.length),
  }
}

export type WaveFlow = Readonly<{
  lengthMs: number
  emptyMs: number
  peakAlive: number
  totalHp: number
  peakIncomingHps: number
  meanIncomingHps: number
}>

const peakWindowRate = (
  arrivals: ReadonlyArray<number>,
  windowSteps: number,
  stepMs: number,
): number => {
  const running = Array.scan(arrivals, 0, (sum, hp) => sum + hp)
  const windows = Array.makeBy(
    Math.max(1, running.length - windowSteps),
    index =>
      Option.getOrElse(Array.get(running, index + windowSteps), () =>
        Array.lastNonEmpty(running),
      ) - Option.getOrElse(Array.get(running, index), () => 0),
  )
  return (
    Array.reduce(windows, 0, (most, sum) => Math.max(most, sum)) /
    ((windowSteps * stepMs) / 1000)
  )
}

// Plays a wave as a flow of health: zombies walk in on the wave clock, the
// player's damage a second drains them in arrival order, holds wait for the
// room to thin, rests rest, and a quiet room hurries the next pack.
export const flowWave: {
  (
    holds: ReadonlyArray<Hold>,
    boss: FlowBoss,
    dps: number,
    rules: FlowRules,
    peakWindowMs: number,
  ): (incoming: ReadonlyArray<Incoming>) => WaveFlow
  (
    incoming: ReadonlyArray<Incoming>,
    holds: ReadonlyArray<Hold>,
    boss: FlowBoss,
    dps: number,
    rules: FlowRules,
    peakWindowMs: number,
  ): WaveFlow
} = Function.dual(
  6,
  (
    incoming: ReadonlyArray<Incoming>,
    holds: ReadonlyArray<Hold>,
    boss: FlowBoss,
    dps: number,
    rules: FlowRules,
    peakWindowMs: number,
  ): WaveFlow => {
    const start: Flow = {
      wallMs: 0,
      clockMs: 0,
      pending: Array.sort(incoming, byArrival),
      alive: [],
      holds,
      beat: FLOWING,
      quietMs: 0,
      boss,
      arrivedHp: 0,
      emptyMs: 0,
      peakAlive: 0,
    }
    const flows = Array.unfold(
      start,
      (flow): Option.Option<readonly [Flow, Flow]> => {
        if (isOver(flow, rules)) {
          return Option.none()
        }
        const next = stepFlow(flow, dps, rules)
        return Option.some([next, next])
      },
    )
    const last = Option.getOrElse(Array.last(flows), () => start)
    const steps: ReadonlyArray<Step> = Array.map(flows, flow => ({
      arrivedHp: flow.arrivedHp,
      alive: flow.alive.length,
    }))
    const totalHp = Number.sumAll(
      Array.map(steps, ({ arrivedHp }) => arrivedHp),
    )
    return {
      lengthMs: last.wallMs,
      emptyMs: last.emptyMs,
      peakAlive: last.peakAlive,
      totalHp,
      peakIncomingHps: peakWindowRate(
        Array.map(steps, ({ arrivedHp }) => arrivedHp),
        Math.max(1, Math.round(peakWindowMs / rules.stepMs)),
        rules.stepMs,
      ),
      meanIncomingHps: last.wallMs > 0 ? totalHp / (last.wallMs / 1000) : 0,
    }
  },
)
