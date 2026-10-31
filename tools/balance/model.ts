// The analytical balance model: per wave and difficulty, straight from the
// game's tables, with no bot and no frames. It rolls each wave's real spawn
// list for a few seeds, buys the bot's loadout from the money those waves
// pay, and drains the incoming health with that loadout's sustained damage
// a second, holds and quiet hurries included. Run it with
// `bun tools/balance/model.ts`. It is instant, so it runs in `bun run test`.

import { Array, Match, Number, Option, Order, type Record, pipe } from 'effect'

import { BOSS_RULES, bossHp, hasBoss } from '../../src/boss'
import {
  FADE_MAX_MS,
  PACK_WARNING_MS,
  QUIET_HURRY_MS,
  RELAX_QUIET_MAX_MS,
  RELAX_TRICKLE_MAX,
  ZOMBIE_ALIVE_MAX,
} from '../../src/constants'
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  toughenSpawns,
} from '../../src/difficulty'
import { rollWave } from '../../src/endlessWaves'
import { EXIT_RULES } from '../../src/exits'
import { FRENZY_RULES, frenzyPacksOf } from '../../src/frenzy'
import type {
  Difficulty,
  Hold,
  PlannedSpawn,
  WeaponKind,
  ZombieKind,
} from '../../src/model'
import { STRAGGLER_KINDS } from '../../src/pacing'
import { SHOP_ITEMS } from '../../src/shop'
import { TRAPS } from '../../src/traps'
import { FINAL_WAVE } from '../../src/wavePlans'
import { waveBonus } from '../../src/waves'
import { UPGRADE_TIERS, WEAPONS, effectiveStats } from '../../src/weapons'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER, scaledHp } from '../../src/zombies'
import { mean } from './summary'

// GUNS

export type Gun = 'Pistol' | 'Shotgun' | 'Smg'
export type SpareGun = 'Shotgun' | 'Smg'

// NOTE: only the fields the damage math reads, so tests can hand-make one.
export type GunStats = Readonly<{
  damage: number
  pellets: number
  fireIntervalMs: number
  magazine: number
  reloadMs: number
}>

export const gunStats = (kind: WeaponKind, tier: number): GunStats =>
  effectiveStats(kind, tier)

// The damage a second a gun lands over a long fight: a magazine emptied at
// its fire rate, then a reload, with hitShare of the damage landing.
export const sustainedDps = (stats: GunStats, hitShare: number): number =>
  (stats.damage * stats.pellets * hitShare * stats.magazine) /
  ((stats.magazine * stats.fireIntervalMs + stats.reloadMs) / 1000)

// The expected seconds one gun takes to kill one zombie of hp, reloads
// included: the first shot lands at once.
export const timeToKill = (
  hp: number,
  stats: GunStats,
  hitShare: number,
): number => {
  const shots = Math.ceil(hp / (stats.damage * stats.pellets * hitShare))
  const reloads = Math.floor((shots - 1) / stats.magazine)
  return ((shots - 1) * stats.fireIntervalMs + reloads * stats.reloadMs) / 1000
}

// ASSUMPTIONS

// NOTE: the share of fired damage that lands is a guess at the bot's aim,
// not a measurement: its hand shake, the SMG's wobble, and the shotgun's
// spray at range. They are the knobs to recalibrate against the bot's shot
// stats if the model and the bot drift apart.
export type Assumptions = Readonly<{
  hitShare: Readonly<Record<Gun, number>>
  gnomeHitShare: number
  seeds: Array.NonEmptyReadonlyArray<number>
  stepMs: number
  peakWindowMs: number
  maxWaveMs: number
  upkeepPerVisit: number
  heartsFromWave: number
  reserve: number
}>

export const ASSUMPTIONS: Assumptions = {
  hitShare: { Pistol: 0.75, Shotgun: 0.6, Smg: 0.6 },
  gnomeHitShare: 0.7,
  seeds: [1, 7920, 15839, 23758, 31677, 39596],
  stepMs: 100,
  peakWindowMs: 5000,
  maxWaveMs: 300_000,
  upkeepPerVisit: 15,
  heartsFromWave: 5,
  reserve: 30,
}

// THE SHOP

export type Catalog = Readonly<{
  gunPrice: Readonly<Record<SpareGun, number>>
  refillPrice: Readonly<Record<SpareGun, number>>
  upgradePrices: Readonly<Record<Gun, ReadonlyArray<number>>>
  plankPrice: number
  plankLimit: number
  gnomePrice: number
  gnomeLimit: number
  kitchenPrice: number
}>

export const CATALOG: Catalog = {
  gunPrice: { Shotgun: SHOP_ITEMS.Shotgun.price, Smg: SHOP_ITEMS.Smg.price },
  refillPrice: {
    Shotgun: SHOP_ITEMS.ShotgunShells.price,
    Smg: SHOP_ITEMS.SmgRounds.price,
  },
  upgradePrices: {
    Pistol: Array.map(UPGRADE_TIERS.Pistol, ({ price }) => price),
    Shotgun: Array.map(UPGRADE_TIERS.Shotgun, ({ price }) => price),
    Smg: Array.map(UPGRADE_TIERS.Smg, ({ price }) => price),
  },
  plankPrice: TRAPS.Barricade.price,
  plankLimit: TRAPS.Barricade.limit,
  gnomePrice: TRAPS.Turret.price,
  gnomeLimit: TRAPS.Turret.limit,
  kitchenPrice: EXIT_RULES.price,
}

export type Spare = Readonly<{ kind: SpareGun; tier: number }>

export type Loadout = Readonly<{
  maybeSpare: Option.Option<Spare>
  pistolTier: number
  gnomes: number
  planks: number
  hasKitchen: boolean
}>

export const STARTING_LOADOUT: Loadout = {
  maybeSpare: Option.none(),
  pistolTier: 0,
  gnomes: 0,
  planks: 0,
  hasKitchen: false,
}

export type Purchase =
  | 'Shotgun'
  | 'Smg'
  | 'Refill'
  | 'Plank'
  | 'Upkeep'
  | 'Gnome'
  | 'SpareUpgrade'
  | 'PistolUpgrade'
  | 'Kitchen'

type Basket = Readonly<{
  money: number
  loadout: Loadout
  bought: ReadonlyArray<Purchase>
}>

const priceOf = (
  catalog: Catalog,
  loadout: Loadout,
  purchase: Purchase,
  upkeep: number,
): Option.Option<number> => {
  const spareKind = Option.map(loadout.maybeSpare, ({ kind }) => kind)
  const spareTier = Option.match(loadout.maybeSpare, {
    onNone: () => 0,
    onSome: ({ tier }) => tier,
  })
  if (purchase === 'Shotgun' || purchase === 'Smg') {
    return Option.some(catalog.gunPrice[purchase])
  } else if (purchase === 'Refill') {
    return Option.map(spareKind, kind => catalog.refillPrice[kind])
  } else if (purchase === 'Plank') {
    return Option.some(catalog.plankPrice)
  } else if (purchase === 'Upkeep') {
    return Option.some(upkeep)
  } else if (purchase === 'Gnome') {
    return Option.some(catalog.gnomePrice)
  } else if (purchase === 'Kitchen') {
    return Option.some(catalog.kitchenPrice)
  } else if (purchase === 'SpareUpgrade') {
    return Option.flatMap(spareKind, kind =>
      Array.get(catalog.upgradePrices[kind], spareTier),
    )
  } else {
    return Array.get(catalog.upgradePrices.Pistol, loadout.pistolTier)
  }
}

const withPurchase = (loadout: Loadout, purchase: Purchase): Loadout => {
  if (purchase === 'Shotgun' || purchase === 'Smg') {
    return { ...loadout, maybeSpare: Option.some({ kind: purchase, tier: 0 }) }
  } else if (purchase === 'Plank') {
    return { ...loadout, planks: loadout.planks + 1 }
  } else if (purchase === 'Gnome') {
    return { ...loadout, gnomes: loadout.gnomes + 1 }
  } else if (purchase === 'Kitchen') {
    return { ...loadout, hasKitchen: true }
  } else if (purchase === 'SpareUpgrade') {
    return {
      ...loadout,
      maybeSpare: Option.map(loadout.maybeSpare, spare => ({
        ...spare,
        tier: spare.tier + 1,
      })),
    }
  } else if (purchase === 'PistolUpgrade') {
    return { ...loadout, pistolTier: loadout.pistolTier + 1 }
  } else {
    return loadout
  }
}

// NOTE: the bot's shopping list in tools/balance/bot.ts, without hearts:
// the SMG once it can, else the shotgun; one refill a visit; two planks;
// upkeep for repairs; the first spare upgrade and a gnome; the kitchen;
// then more upgrades and gnomes while a reserve stays, the spare to its top
// tier before the pistol.
const wantedNext = (
  catalog: Catalog,
  basket: Basket,
  upkeep: number,
  reserve: number,
): Option.Option<Purchase> => {
  const { loadout, money, bought } = basket
  const affords = (purchase: Purchase, keep: number) =>
    Option.match(priceOf(catalog, loadout, purchase, upkeep), {
      onNone: () => false,
      onSome: price => money - price >= keep,
    })
  const once = (purchase: Purchase) => !Array.contains(bought, purchase)
  return Option.match(loadout.maybeSpare, {
    onNone: () =>
      affords('Smg', 0)
        ? Option.some<Purchase>('Smg')
        : affords('Shotgun', 0)
          ? Option.some<Purchase>('Shotgun')
          : Option.none(),
    onSome: spare => {
      const maxTier = catalog.upgradePrices[spare.kind].length
      const candidates: ReadonlyArray<[Purchase, boolean]> = [
        [
          'Smg',
          spare.kind === 'Shotgun' && spare.tier === 0 && affords('Smg', 0),
        ],
        ['Refill', once('Refill') && affords('Refill', 0)],
        ['Plank', loadout.planks < catalog.plankLimit && affords('Plank', 0)],
        [
          'Upkeep',
          once('Upkeep') &&
            upkeep > 0 &&
            loadout.planks + loadout.gnomes > 0 &&
            affords('Upkeep', 0),
        ],
        ['SpareUpgrade', spare.tier < 1 && affords('SpareUpgrade', reserve)],
        ['Gnome', loadout.gnomes < 1 && affords('Gnome', reserve)],
        [
          'Kitchen',
          !loadout.hasKitchen &&
            spare.kind === 'Smg' &&
            spare.tier >= 2 &&
            loadout.gnomes >= 1 &&
            loadout.planks >= catalog.plankLimit &&
            affords('Kitchen', reserve),
        ],
        [
          'SpareUpgrade',
          spare.tier < maxTier && affords('SpareUpgrade', reserve),
        ],
        [
          'PistolUpgrade',
          spare.tier >= maxTier &&
            loadout.pistolTier < catalog.upgradePrices.Pistol.length &&
            affords('PistolUpgrade', reserve),
        ],
        [
          'Gnome',
          loadout.gnomes < catalog.gnomeLimit &&
            spare.tier >= 2 &&
            affords('Gnome', reserve),
        ],
      ]
      return pipe(
        candidates,
        Array.findFirst(([, isWanted]) => isWanted),
        Option.map(([purchase]) => purchase),
      )
    },
  })
}

const MAX_PURCHASES_A_VISIT = 20

export type Visit = Readonly<{
  moneyOnArrival: number
  bought: ReadonlyArray<Purchase>
  spent: number
  moneyAfter: number
  loadout: Loadout
}>

// One shop visit: buy what the list wants until nothing more is wanted.
export const shopVisit = (
  catalog: Catalog,
  money: number,
  loadout: Loadout,
  upkeep: number,
  reserve: number,
): Visit => {
  const basket = Array.reduce(
    Array.makeBy(MAX_PURCHASES_A_VISIT, index => index),
    { money, loadout, bought: [] } satisfies Basket,
    (current: Basket): Basket =>
      Option.match(wantedNext(catalog, current, upkeep, reserve), {
        onNone: () => current,
        onSome: purchase => ({
          money:
            current.money -
            Option.getOrElse(
              priceOf(catalog, current.loadout, purchase, upkeep),
              () => 0,
            ),
          loadout: withPurchase(current.loadout, purchase),
          bought: Array.append(current.bought, purchase),
        }),
      }),
  )
  return {
    moneyOnArrival: money,
    bought: basket.bought,
    spent: money - basket.money,
    moneyAfter: basket.money,
    loadout: basket.loadout,
  }
}

// DAMAGE

export const heldGun = (
  loadout: Loadout,
): Readonly<{ gun: Gun; tier: number }> =>
  Option.match(loadout.maybeSpare, {
    onNone: () => ({ gun: 'Pistol', tier: loadout.pistolTier }),
    onSome: ({ kind, tier }) => ({ gun: kind, tier }),
  })

// NOTE: the default bot fights with its spare gun and refills it every
// visit, so the held gun is the spare once it has one.
export const loadoutDps = (
  loadout: Loadout,
  assumptions: Assumptions,
): number => {
  const { gun, tier } = heldGun(loadout)
  const gnome = WEAPONS.Peashooter
  return (
    sustainedDps(gunStats(gun, tier), assumptions.hitShare[gun]) +
    loadout.gnomes *
      ((gnome.damage * assumptions.gnomeHitShare * 1000) / gnome.fireIntervalMs)
  )
}

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
// quiet relax may pull in early, as the trickle in src/pacing.ts does.
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
// then ends, as the trickle in src/pacing.ts does.
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
// warning, never past a hold, as QUIET_HURRY_MS does in src/pacing.ts.
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
export const flowWave = (
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
  const totalHp = Number.sumAll(Array.map(steps, ({ arrivedHp }) => arrivedHp))
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
}

// THE REAL WAVES

export type RolledWave = Readonly<{
  spawns: ReadonlyArray<PlannedSpawn>
  holds: ReadonlyArray<Hold>
  boss: FlowBoss
}>

export const rolledWave = (
  seed: number,
  wave: number,
  difficulty: Difficulty,
): RolledWave => {
  const [, rolled] = rollWave(seed, wave)
  const spawns = toughenSpawns(difficulty, rolled.spawns)
  return {
    spawns,
    holds: rolled.holds,
    boss: hasBoss(wave)
      ? {
          _tag: 'Waiting',
          waitBelow: Math.round(
            spawns.length * (1 - BOSS_RULES.arriveAfterShare),
          ),
          hp: bossHp(difficulty, spawns),
        }
      : { _tag: 'Absent' },
  }
}

export const spawnHp = (spawn: PlannedSpawn): number =>
  scaledHp(ZOMBIE_KINDS[spawn.kind].hp, spawn.hpScale)

const arrivalOf = (
  spawn: PlannedSpawn,
  spawns: ReadonlyArray<PlannedSpawn>,
): Arrival =>
  Array.contains(STRAGGLER_KINDS, spawn.kind) &&
  Array.filter(spawns, ({ pack }) => pack === spawn.pack).length === 1
    ? 'Straggler'
    : 'Pack'

const incomingOf = (rolled: RolledWave): ReadonlyArray<Incoming> =>
  Array.map(rolled.spawns, spawn => ({
    atMs: spawn.atMs,
    hp: spawnHp(spawn),
    arrival: arrivalOf(spawn, rolled.spawns),
  }))

// The money a wave pays when the bot kills everything and wipes every
// frenzied pack: bounties, the boss's bounty, the pack bonus, and the clear.
export const wavePay = (rolled: RolledWave, wave: number): number =>
  Number.sumAll(
    Array.map(rolled.spawns, ({ kind }) => ZOMBIE_KINDS[kind].bounty),
  ) +
  (rolled.boss._tag === 'Waiting' ? ZOMBIE_KINDS.Boss.bounty : 0) +
  Number.sumAll(Array.map(frenzyPacksOf(rolled.spawns), ({ left }) => left)) *
    FRENZY_RULES.bonusPerZombie +
  waveBonus(wave)

// THE MODEL

export type WaveRow = Readonly<{
  wave: number
  difficulty: Difficulty
  zombies: number
  totalHp: number
  pay: number
  moneyOnArrival: number
  bought: ReadonlyArray<Purchase>
  loadout: Loadout
  dps: number
  lengthSeconds: number
  emptySeconds: number
  peakAlive: number
  meanIncomingHps: number
  peakIncomingHps: number
  peakRatio: number
  meanRatio: number
}>

export type Economy = Readonly<{
  visits: ReadonlyArray<Visit>
  pays: ReadonlyArray<number>
}>

// NOTE: wave 1 is the tutorial and its stall is closed, so the first visit
// buys nothing. Traps need repairs from the third visit on.
const FIRST_VISIT: Visit = {
  moneyOnArrival: 0,
  bought: [],
  spent: 0,
  moneyAfter: 0,
  loadout: STARTING_LOADOUT,
}

const FIRST_UPKEEP_WAVE = 3

// NOTE: upkeep is the money a visit spends on staying alive rather than on
// getting stronger: glue for the traps from the third visit, and a heart a
// visit once the waves start to bite.
export const upkeepFor = (wave: number, assumptions: Assumptions): number =>
  (wave >= FIRST_UPKEEP_WAVE ? assumptions.upkeepPerVisit : 0) +
  (wave >= assumptions.heartsFromWave ? SHOP_ITEMS.Heart.price : 0)

// The visit before each wave, index 0 for wave 1. Money does not depend on
// the level, since bounties and the clear bonus are the same on every level
// and the model kills everything.
export const economy = (
  catalog: Catalog,
  pays: ReadonlyArray<number>,
  assumptions: Assumptions,
): Economy => {
  const visits = Array.scan(
    Array.map(Array.take(pays, Math.max(0, pays.length - 1)), (pay, index) => ({
      pay,
      wave: index + 2,
    })),
    FIRST_VISIT,
    (previous: Visit, { pay, wave }): Visit =>
      shopVisit(
        catalog,
        previous.moneyAfter + pay,
        previous.loadout,
        upkeepFor(wave, assumptions),
        assumptions.reserve,
      ),
  )
  return { visits, pays }
}

const waveNumbers = (lastWave: number): Array.NonEmptyReadonlyArray<number> =>
  Array.makeBy(Math.max(1, lastWave), index => index + 1)

// The expected pay of each wave, on the mean over the model's seeds.
export const expectedPays = (
  assumptions: Assumptions,
  lastWave: number,
): ReadonlyArray<number> =>
  Array.map(waveNumbers(lastWave), wave =>
    mean(
      Array.map(assumptions.seeds, seed =>
        wavePay(rolledWave(seed, wave, 'Normal'), wave),
      ),
    ),
  )

export const modelRows = (
  difficulty: Difficulty,
  assumptions: Assumptions = ASSUMPTIONS,
  lastWave: number = FINAL_WAVE,
): ReadonlyArray<WaveRow> => {
  const pays = expectedPays(assumptions, lastWave)
  const { visits } = economy(CATALOG, pays, assumptions)
  const rules = flowRules(assumptions)
  return Array.map(waveNumbers(lastWave), wave => {
    const visit = Option.getOrElse(
      Array.get(visits, wave - 1),
      () => FIRST_VISIT,
    )
    const dps = loadoutDps(visit.loadout, assumptions)
    const rolls = Array.map(assumptions.seeds, seed =>
      rolledWave(seed, wave, difficulty),
    )
    const flows = Array.map(rolls, rolled =>
      flowWave(
        incomingOf(rolled),
        rolled.holds,
        rolled.boss,
        dps,
        rules,
        assumptions.peakWindowMs,
      ),
    )
    const flowMean = (pick: (flow: WaveFlow) => number) =>
      mean(Array.map(flows, pick))
    const peakIncomingHps = flowMean(flow => flow.peakIncomingHps)
    const meanIncomingHps = flowMean(flow => flow.meanIncomingHps)
    return {
      wave,
      difficulty,
      zombies: mean(
        Array.map(
          rolls,
          ({ spawns, boss }) =>
            spawns.length + (boss._tag === 'Waiting' ? 1 : 0),
        ),
      ),
      totalHp: flowMean(({ totalHp }) => totalHp),
      pay: Option.getOrElse(Array.get(pays, wave - 1), () => 0),
      moneyOnArrival: visit.moneyOnArrival,
      bought: visit.bought,
      loadout: visit.loadout,
      dps,
      lengthSeconds: flowMean(({ lengthMs }) => lengthMs) / 1000,
      emptySeconds: flowMean(({ emptyMs }) => emptyMs) / 1000,
      peakAlive: flowMean(({ peakAlive }) => peakAlive),
      meanIncomingHps,
      peakIncomingHps,
      peakRatio: dps > 0 ? peakIncomingHps / dps : 0,
      meanRatio: dps > 0 ? meanIncomingHps / dps : 0,
    }
  })
}

export type BalanceModel = Readonly<Record<Difficulty, ReadonlyArray<WaveRow>>>

export const balanceModel = (
  assumptions: Assumptions = ASSUMPTIONS,
): BalanceModel => ({
  Easy: modelRows('Easy', assumptions),
  Normal: modelRows('Normal', assumptions),
  Hard: modelRows('Hard', assumptions),
  Nightmare: modelRows('Nightmare', assumptions),
})

// TIME TO KILL

export type KillTime = Readonly<{
  kind: ZombieKind
  hp: number
  seconds: Readonly<Record<Gun, number>>
}>

const KILL_TIME_KINDS: ReadonlyArray<ZombieKind> = [
  ...ZOMBIE_KIND_ORDER,
  'Boss',
]

// Seconds to kill one zombie of each kind on a level, at the base health
// scale, for every gun at tier.
export const killTimes = (
  difficulty: Difficulty,
  tierOf: (gun: Gun) => number,
  assumptions: Assumptions = ASSUMPTIONS,
): ReadonlyArray<KillTime> =>
  Array.map(KILL_TIME_KINDS, kind => {
    const hp = scaledHp(
      ZOMBIE_KINDS[kind].hp,
      DIFFICULTIES[difficulty].healthScale,
    )
    const seconds = (gun: Gun) =>
      timeToKill(hp, gunStats(gun, tierOf(gun)), assumptions.hitShare[gun])
    return {
      kind,
      hp,
      seconds: {
        Pistol: seconds('Pistol'),
        Shotgun: seconds('Shotgun'),
        Smg: seconds('Smg'),
      },
    }
  })

export const maxTierOf = (gun: Gun): number => UPGRADE_TIERS[gun].length

// MONEY AGAINST PRICES

export type Prices = Readonly<{
  earned: number
  fullKit: Readonly<Record<SpareGun, number>>
}>

// The whole campaign's pay against the price of a full kit: the spare gun
// and all its tiers, every pistol tier, two planks, two gnomes, and the
// kitchen.
export const moneyAgainstPrices = (
  catalog: Catalog = CATALOG,
  assumptions: Assumptions = ASSUMPTIONS,
): Prices => {
  const kit = (gun: SpareGun) =>
    catalog.gunPrice[gun] +
    Number.sumAll(catalog.upgradePrices[gun]) +
    Number.sumAll(catalog.upgradePrices.Pistol) +
    catalog.plankLimit * catalog.plankPrice +
    catalog.gnomeLimit * catalog.gnomePrice +
    catalog.kitchenPrice
  return {
    earned: Number.sumAll(expectedPays(assumptions, FINAL_WAVE)),
    fullKit: { Shotgun: kit('Shotgun'), Smg: kit('Smg') },
  }
}

// PRINTING

const fixed = (value: number, digits: number, width: number): string =>
  value.toFixed(digits).padStart(width)

export const loadoutLabel = (loadout: Loadout): string =>
  [
    Option.match(loadout.maybeSpare, {
      onNone: () => 'pistol',
      onSome: ({ kind, tier }) => `${kind.toLowerCase()} t${tier}`,
    }),
    loadout.pistolTier > 0 ? `pistol t${loadout.pistolTier}` : '',
    loadout.gnomes > 0 ? `${loadout.gnomes} gnome` : '',
    loadout.planks > 0 ? `${loadout.planks} plank` : '',
    loadout.hasKitchen ? 'kitchen' : '',
  ]
    .filter(part => part !== '')
    .join(', ')

export const formatRows = (rows: ReadonlyArray<WaveRow>): string =>
  Array.join(
    [
      'Wave  zombies  total hp  $ arrive  loadout                              dps  length s  empty s  peak alive  in hp/s mean  peak  peak/dps',
      ...Array.map(
        rows,
        row =>
          `${fixed(row.wave, 0, 4)}  ${fixed(row.zombies, 1, 7)}  ${fixed(row.totalHp, 0, 8)}  ${fixed(row.moneyOnArrival, 0, 8)}  ${loadoutLabel(row.loadout).padEnd(35)}  ${fixed(row.dps, 2, 5)}  ${fixed(row.lengthSeconds, 0, 8)}  ${fixed(row.emptySeconds, 1, 7)}  ${fixed(row.peakAlive, 1, 10)}  ${fixed(row.meanIncomingHps, 2, 12)}  ${fixed(row.peakIncomingHps, 2, 4)}  ${fixed(row.peakRatio, 2, 8)}`,
      ),
    ],
    '\n',
  )

export const formatKillTimes = (times: ReadonlyArray<KillTime>): string =>
  Array.join(
    [
      'Kind       hp  pistol s  shotgun s  smg s',
      ...Array.map(
        times,
        ({ kind, hp, seconds }) =>
          `${kind.padEnd(9)} ${fixed(hp, 0, 3)}  ${fixed(seconds.Pistol, 2, 8)}  ${fixed(seconds.Shotgun, 2, 9)}  ${fixed(seconds.Smg, 2, 5)}`,
      ),
    ],
    '\n',
  )

export const formatModel = (model: BalanceModel): string => {
  const prices = moneyAgainstPrices()
  return Array.join(
    [
      ...Array.flatMap(DIFFICULTY_ORDER, difficulty => [
        `${difficulty}`,
        formatRows(model[difficulty]),
        '',
      ]),
      'Seconds to kill one zombie on Normal, tier 0',
      formatKillTimes(killTimes('Normal', () => 0)),
      '',
      'Seconds to kill one zombie on Normal, every gun at its top tier',
      formatKillTimes(killTimes('Normal', maxTierOf)),
      '',
      `Money: a full campaign pays about $${prices.earned.toFixed(0)}. A full kit costs $${prices.fullKit.Smg} with the SMG and $${prices.fullKit.Shotgun} with the shotgun.`,
    ],
    '\n',
  )
}

if (import.meta.main === true) {
  console.log(formatModel(balanceModel()))
}
