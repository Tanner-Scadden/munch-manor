import { Array, Option, Record, Result, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import {
  type Box,
  type Level,
  type Room,
  circleTouchesBox,
  isSolidAt,
  levelOf,
  roomAt,
} from './arena'
import {
  type BlastSpec,
  ZOMBIE_BLAST_TARGET,
  blastAll,
  bountyOf,
} from './combat'
import { PLAYER_MAX_HP, PLAYER_RADIUS, PLAYER_SPEED } from './constants'
import { PICKUP_NAMES } from './names'
import { forEachSeat, isCoop, isStanding, leadSeatOf } from './party'
import { nextRandom } from './prng'
import { earn } from './shop'
import type { SoundEffect } from './soundEffect'
import { totalKills } from './stats'
import { trapBlockers } from './traps'
import {
  type WeaponStats,
  canReload,
  finishReload,
  isReloading,
  statsAt,
} from './weapons'
import type { World } from './world'
import {
  Beat,
  BoostKind,
  BoostTimer,
  type Boosts,
  type BulletGlaze,
  type CalloutLook,
  GameEvent,
  type Loot,
  Phase,
  type Pickup,
  type PickupKind,
  Pierce,
  type Player,
  Prize,
  ShopState,
  type Vector,
  type WeaponKind,
  type ZombieKind,
} from './worldSchema'

// BOOSTS

export type Ammo = 'Spent' | 'Free'

type BoostStats = Readonly<{
  durationMs: number
  fireIntervalScale: number
  damageScale: number
  knockbackScale: number
  speedScale: number
  pierce: number
  ammo: Ammo
  glaze: BulletGlaze
  color: string
}>

export const BOOSTS: Readonly<Record<BoostKind, BoostStats>> = {
  RapidFire: {
    durationMs: 8000,
    fireIntervalScale: 0.55,
    damageScale: 1,
    knockbackScale: 1,
    speedScale: 1,
    pierce: 0,
    ammo: 'Free',
    glaze: 'Spicy',
    color: '#ff5a2e',
  },
  Damage: {
    durationMs: 8000,
    fireIntervalScale: 1,
    damageScale: 2,
    knockbackScale: 1.5,
    speedScale: 1,
    pierce: 0,
    ammo: 'Spent',
    glaze: 'Mean',
    color: '#c46bff',
  },
  Speed: {
    durationMs: 10000,
    fireIntervalScale: 1,
    damageScale: 1,
    knockbackScale: 1,
    speedScale: 1.4,
    pierce: 0,
    ammo: 'Spent',
    glaze: 'Plain',
    color: '#5fe0ff',
  },
  Pierce: {
    durationMs: 9000,
    fireIntervalScale: 1,
    damageScale: 1,
    knockbackScale: 1,
    speedScale: 1,
    pierce: 3,
    ammo: 'Spent',
    glaze: 'Skewer',
    color: '#9be36a',
  },
}

export const BOOST_KIND_ORDER: ReadonlyArray<BoostKind> = BoostKind.literals

const GLAZE_ORDER: ReadonlyArray<BoostKind> = ['Pierce', 'Damage', 'RapidFire']

export const BOOST_STACK_MAX = 1.5
export const BOOST_WARNING_MS = 2000

// PICKUPS

const PickupEffect = defineTaggedUnion({
  Boost: { boost: BoostKind },
  Burp: {},
  Heal: { hearts: Schema.Number },
})
type PickupEffect = typeof PickupEffect.Type

type PickupStats = Readonly<{
  name: string
  blurb: string
  weight: number
  effect: PickupEffect
  sound: SoundEffect
  color: string
}>

export const PICKUPS: Readonly<Record<PickupKind, PickupStats>> = {
  RapidFire: {
    name: PICKUP_NAMES.RapidFire,
    blurb: 'FASTER, NO RELOADS',
    weight: 24,
    effect: PickupEffect.Boost({ boost: 'RapidFire' }),
    sound: 'GrabHotSauce',
    color: BOOSTS.RapidFire.color,
  },
  Damage: {
    name: PICKUP_NAMES.Damage,
    blurb: 'DOUBLE DAMAGE',
    weight: 22,
    effect: PickupEffect.Boost({ boost: 'Damage' }),
    sound: 'GrabMeanBeans',
    color: BOOSTS.Damage.color,
  },
  Speed: {
    name: PICKUP_NAMES.Speed,
    blurb: 'RUN FASTER',
    weight: 16,
    effect: PickupEffect.Boost({ boost: 'Speed' }),
    sound: 'GrabZoomySocks',
    color: BOOSTS.Speed.color,
  },
  Pierce: {
    name: PICKUP_NAMES.Pierce,
    blurb: 'SHOTS GO THROUGH',
    weight: 20,
    effect: PickupEffect.Boost({ boost: 'Pierce' }),
    sound: 'GrabKebullets',
    color: BOOSTS.Pierce.color,
  },
  Burp: {
    name: PICKUP_NAMES.Burp,
    blurb: 'EVERYBODY BACK!',
    weight: 10,
    effect: PickupEffect.Burp(),
    sound: 'GrabBurp',
    color: '#d6f25c',
  },
  Heart: {
    name: PICKUP_NAMES.Heart,
    blurb: '+1 HEART',
    weight: 8,
    effect: PickupEffect.Heal({ hearts: 1 }),
    sound: 'GrabHeart',
    color: '#ff5d6c',
  },
}

const PICKUP_KIND_ORDER: ReadonlyArray<PickupKind> = [
  'RapidFire',
  'Damage',
  'Speed',
  'Pierce',
  'Burp',
  'Heart',
]

export const PICKUP_LIFETIME_MS = 10000
export const PICKUP_BLINK_MS = 3000
const PICKUP_RADIUS = 4
const PICKUP_GRAB_PX = PLAYER_RADIUS + 4
export const CALLOUT_LIFETIME_MS: Readonly<Record<CalloutLook, number>> = {
  Explained: 1600,
  Named: 1000,
}

export const BURP_RADIUS = 110
export const BURP_DAMAGE = 5
const BURP_KNOCKBACK = 260

// DROPS

export const DROP_CHANCE: Readonly<Record<ZombieKind, number>> = {
  Shambler: 0.03,
  Runner: 0.03,
  Tank: 0.4,
  Exploder: 0.04,
  Thrower: 0.12,
  Crawler: 0.03,
  Boss: 1,
}

type DropRules = Readonly<{
  floorMax: number
  gapMs: number
  pityMs: number
  prizeChance: number
}>

export const DROP_RULES: DropRules = {
  floorMax: 2,
  gapMs: 8000,
  pityMs: 25000,
  prizeChance: 0.5,
}
const TUTORIAL_WAVE = 1
export const TUTORIAL_DROP_KILL = 3
export const TUTORIAL_DROP: PickupKind = 'RapidFire'

// EFFECTIVE STATS

const isOn = BoostTimer.isAnyOf(['On'])

export const isBoosted = (boosts: Boosts, kind: BoostKind): boolean =>
  isOn(boosts[kind])

const activeBoosts = (boosts: Boosts): ReadonlyArray<BoostStats> =>
  Array.filterMap(BOOST_KIND_ORDER, kind =>
    isOn(boosts[kind]) ? Result.succeed(BOOSTS[kind]) : Result.failVoid,
  )

const productOf = (
  boosts: Boosts,
  scaleOf: (stats: BoostStats) => number,
): number =>
  Array.reduce(activeBoosts(boosts), 1, (product, stats) =>
    Math.max(0, product * scaleOf(stats)),
  )

const boostWeapon = (stats: WeaponStats, boosts: Boosts): WeaponStats =>
  modifyFields(stats, {
    fireIntervalMs: interval =>
      Math.max(
        1,
        Math.round(
          interval *
            productOf(boosts, ({ fireIntervalScale }) => fireIntervalScale),
        ),
      ),
    damage: damage =>
      Math.round(damage * productOf(boosts, ({ damageScale }) => damageScale)),
    knockback: knockback =>
      knockback * productOf(boosts, ({ knockbackScale }) => knockbackScale),
  })

export const firingStats = (
  boosts: Boosts,
  kind: WeaponKind,
  tier: number,
): WeaponStats => boostWeapon(statsAt(kind, tier), boosts)

export const playerSpeed = (boosts: Boosts): number =>
  PLAYER_SPEED * productOf(boosts, ({ speedScale }) => speedScale)

export const isAmmoFree = (boosts: Boosts): boolean =>
  Array.some(activeBoosts(boosts), ({ ammo }) => ammo === 'Free')

export const bulletGlaze = (boosts: Boosts): BulletGlaze =>
  pipe(
    GLAZE_ORDER,
    Array.findFirst(kind => isOn(boosts[kind])),
    Option.match({
      onNone: (): BulletGlaze => 'Plain',
      onSome: kind => BOOSTS[kind].glaze,
    }),
  )

export const bulletPierce = (boosts: Boosts): Pierce => {
  const extra = Array.reduce(
    activeBoosts(boosts),
    0,
    (sum, { pierce }) => sum + pierce,
  )
  return extra > 0
    ? Pierce.Skewers({ left: extra, struck: [] })
    : Pierce.Stops()
}

export const keepTopped = (player: Player, boosts: Boosts): Player =>
  isAmmoFree(boosts) && (isReloading(player) || canReload(player))
    ? finishReload(player)
    : player

// TIMERS

const tickTimer = (timer: BoostTimer, deltaMs: number): BoostTimer =>
  BoostTimer.match(timer, {
    Off: () => timer,
    On: ({ remainingMs, durationMs }) =>
      remainingMs > deltaMs
        ? BoostTimer.On({ remainingMs: remainingMs - deltaMs, durationMs })
        : BoostTimer.Off(),
  })

const extendTimer = (timer: BoostTimer, durationMs: number): BoostTimer => {
  const remainingMs = Math.min(
    durationMs * BOOST_STACK_MAX,
    BoostTimer.match(timer, {
      Off: () => 0,
      On: current => current.remainingMs,
    }) + durationMs,
  )
  return BoostTimer.On({ remainingMs, durationMs: remainingMs })
}

const tickBoosts = (model: World, deltaMs: number): World => {
  if (!Array.some(BOOST_KIND_ORDER, kind => isOn(model.boosts[kind]))) {
    return model
  }

  const boosts: Boosts = Record.map(model.boosts, timer =>
    tickTimer(timer, deltaMs),
  )
  const faded = Array.filter(
    BOOST_KIND_ORDER,
    kind => isOn(model.boosts[kind]) && !isOn(boosts[kind]),
  )
  return modifyFields(model, {
    boosts: () => boosts,
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.map(faded, kind =>
        GameEvent.BoostFaded({ x: model.player.x, y: model.player.y, kind }),
      ),
    ],
  })
}

// FLOOR

const agePickups = (model: World, deltaMs: number): World => {
  if (Array.isReadonlyArrayEmpty(model.pickups)) {
    return model
  }

  const [kept, fizzled] = Array.partition(
    model.pickups,
    (pickup): Result.Result<Pickup, Pickup> =>
      pickup.ageMs + deltaMs < PICKUP_LIFETIME_MS
        ? Result.succeed(
            modifyFields(pickup, { ageMs: ageMs => ageMs + deltaMs }),
          )
        : Result.fail(pickup),
  )
  return modifyFields(model, {
    pickups: () => kept,
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.map(fizzled, ({ x, y }) => GameEvent.PickupFizzled({ x, y })),
    ],
  })
}

// GRABBING

const isWithinGrab =
  (player: Player) =>
  (pickup: Pickup): boolean =>
    Math.hypot(pickup.x - player.x, pickup.y - player.y) <= PICKUP_GRAB_PX

const burpAt = (model: World, at: Vector): World => {
  const blast: BlastSpec = {
    x: at.x,
    y: at.y,
    radius: BURP_RADIUS,
    playerDamage: 0,
    zombieDamage: BURP_DAMAGE,
    trapDamage: 0,
    knockback: BURP_KNOCKBACK,
  }
  const outcome = blastAll(blast, model.zombies, ZOMBIE_BLAST_TARGET)
  return modifyFields(model, {
    zombies: () => outcome.targets,
    wallet: wallet => earn(wallet, bountyOf(outcome.events)),
    frameEvents: frameEvents => [
      ...frameEvents,
      GameEvent.Burped({ x: at.x, y: at.y, radius: BURP_RADIUS }),
      ...outcome.events,
    ],
  })
}

const applyEffect = (model: World, effect: PickupEffect): World =>
  PickupEffect.match(effect, {
    Boost: ({ boost }) => {
      const boosts: Boosts = Record.map(model.boosts, (timer, kind) =>
        kind === boost ? extendTimer(timer, BOOSTS[boost].durationMs) : timer,
      )
      return modifyFields(model, {
        boosts: () => boosts,
        player: player => keepTopped(player, boosts),
      })
    },
    Burp: () => burpAt(model, model.player),
    Heal: ({ hearts }) =>
      modifyFields(model, {
        player: player =>
          modifyFields(player, {
            hp: hp => Math.min(PLAYER_MAX_HP, hp + hearts),
          }),
      }),
  })

const grab = (model: World, pickup: Pickup): World =>
  modifyFields(applyEffect(model, PICKUPS[pickup.kind].effect), {
    frameEvents: Array.append(
      GameEvent.PickupGrabbed({ x: pickup.x, y: pickup.y, kind: pickup.kind }),
    ),
  })

const grabPickups = (model: World): World => {
  if (Array.isReadonlyArrayEmpty(model.pickups)) {
    return model
  }

  const [grabbed, left] = Array.partition(
    model.pickups,
    (pickup): Result.Result<Pickup, Pickup> =>
      isWithinGrab(model.player)(pickup)
        ? Result.succeed(pickup)
        : Result.fail(pickup),
  )
  if (Array.isReadonlyArrayEmpty(grabbed)) {
    return model
  }

  return Array.reduce(
    grabbed,
    modifyFields(model, { pickups: () => left }),
    grab,
  )
}

// DROPPING

const SPOT_LEFT = 16
const SPOT_TOP = 26
const SPOT_EDGE = 16
const SPOT_STEPS = 24

// NOTE: a drop settles inside the room it fell in, so one in the kitchen
// stays in the kitchen and one in the parlour lands where it always did.
const roomMiddleOf = ({ box }: Room): Vector => ({
  x: (box.left + box.right) / 2,
  y: (box.top + box.bottom) / 2 + 5,
})

const isClearSpot =
  (level: Level, blockers: ReadonlyArray<Box>) =>
  (spot: Vector): boolean =>
    !isSolidAt(level, spot) &&
    !Array.some(blockers, box => circleTouchesBox(spot, PICKUP_RADIUS, box))

const settleSpot = (
  level: Level,
  point: Vector,
  blockers: ReadonlyArray<Box>,
): Vector => {
  const room = roomAt(level, point)
  const middle = roomMiddleOf(room)
  const start = {
    x: Math.round(
      Math.min(
        room.box.right - SPOT_EDGE,
        Math.max(room.box.left + SPOT_LEFT, point.x),
      ),
    ),
    y: Math.round(
      Math.min(
        room.box.bottom - SPOT_EDGE,
        Math.max(room.box.top + SPOT_TOP, point.y),
      ),
    ),
  }
  return pipe(
    Array.makeBy(SPOT_STEPS + 1, step => ({
      x: Math.round(start.x + ((middle.x - start.x) * step) / SPOT_STEPS),
      y: Math.round(start.y + ((middle.y - start.y) * step) / SPOT_STEPS),
    })),
    Array.findFirst(isClearSpot(level, blockers)),
    Option.getOrElse(() => middle),
  )
}

const eligibleKinds = (player: Player): ReadonlyArray<PickupKind> =>
  Array.filter(
    PICKUP_KIND_ORDER,
    kind =>
      !PickupEffect.isAnyOf(['Heal'])(PICKUPS[kind].effect) ||
      player.hp < PLAYER_MAX_HP,
  )

const pickKindAt = (
  roll: number,
  kinds: ReadonlyArray<PickupKind>,
): PickupKind => {
  const total = Array.reduce(
    kinds,
    0,
    (sum, kind) => sum + PICKUPS[kind].weight,
  )
  const target = roll * total
  return pipe(
    kinds,
    Array.reduce(
      { reached: 0, maybeKind: Option.none<PickupKind>() },
      (pick, kind) => {
        const reached = pick.reached + PICKUPS[kind].weight
        return Option.isSome(pick.maybeKind) || target >= reached
          ? { reached, maybeKind: pick.maybeKind }
          : { reached, maybeKind: Option.some(kind) }
      },
    ),
    ({ maybeKind }) => maybeKind,
    Option.orElse(() => Array.last(kinds)),
    Option.getOrElse((): PickupKind => TUTORIAL_DROP),
  )
}

type Kill = Readonly<{ x: number; y: number; kind: ZombieKind }>

const killsIn = (events: ReadonlyArray<GameEvent>): ReadonlyArray<Kill> =>
  Array.filterMap(events, event =>
    GameEvent.isAnyOf(['ZombieKilled'])(event)
      ? Result.succeed({ x: event.x, y: event.y, kind: event.kind })
      : Result.failVoid,
  )

const placePickup = (model: World, kind: PickupKind, at: Vector): World => {
  const level = levelOf(model)
  const spot = settleSpot(level, at, trapBlockers(level, model.traps))
  const pickup: Pickup = {
    id: model.nextEntityId,
    kind,
    x: spot.x,
    y: spot.y,
    ageMs: 0,
  }
  return modifyFields(model, {
    pickups: Array.append(pickup),
    nextEntityId: id => id + 1,
    frameEvents: Array.append(
      GameEvent.PickupDropped({ x: spot.x, y: spot.y, kind }),
    ),
  })
}

const dropTutorialPickup = (
  model: World,
  kills: ReadonlyArray<Kill>,
): World => {
  const killsBefore = totalKills(model.stats)
  return pipe(
    Array.get(kills, TUTORIAL_DROP_KILL - 1 - killsBefore),
    Option.filter(() => killsBefore < TUTORIAL_DROP_KILL),
    Option.match({
      onNone: () => model,
      onSome: kill => placePickup(model, TUTORIAL_DROP, kill),
    }),
  )
}

const isFading = Beat.isAnyOf(['Fading'])

const oweForPeak = (prize: Prize, before: Beat, after: Beat): Prize =>
  !isFading(before) && isFading(after) ? Prize.Owed() : prize

type Roll = Readonly<{ rngState: number; maybeKill: Option.Option<Kill> }>

const dropOdds = (loot: Loot, kind: ZombieKind): number =>
  Math.max(
    loot.dryMs >= DROP_RULES.pityMs ? 1 : 0,
    Prize.isAnyOf(['Owed'])(loot.prize) ? DROP_RULES.prizeChance : 0,
    loot.dryMs >= DROP_RULES.gapMs ? DROP_CHANCE[kind] : 0,
  )

const rollForKill =
  (loot: Loot) =>
  (roll: Roll, kill: Kill): Roll => {
    if (Option.isSome(roll.maybeKill)) {
      return roll
    }

    const draw = nextRandom(roll.rngState)
    return {
      rngState: draw.nextState,
      maybeKill:
        draw.value < dropOdds(loot, kill.kind)
          ? Option.some(kill)
          : Option.none(),
    }
  }

const dropFromKills = (
  model: World,
  kills: ReadonlyArray<Kill>,
  worldMs: number,
  beatBefore: Beat,
): World => {
  const loot = modifyFields(model.loot, {
    dryMs: dryMs => dryMs + worldMs,
    prize: prize => oweForPeak(prize, beatBefore, model.pacing.beat),
  })
  if (
    Array.isReadonlyArrayEmpty(kills) ||
    model.pickups.length >= DROP_RULES.floorMax
  ) {
    return modifyFields(model, { loot: () => loot })
  }

  const rolled = Array.reduce(
    kills,
    { rngState: loot.rngState, maybeKill: Option.none<Kill>() },
    rollForKill(loot),
  )
  return Option.match(rolled.maybeKill, {
    onNone: () =>
      modifyFields(model, {
        loot: () =>
          modifyFields(loot, {
            rngState: () => rolled.rngState,
            prize: () => Prize.Settled(),
          }),
      }),
    onSome: kill => {
      const kindDraw = nextRandom(rolled.rngState)
      const kind = pickKindAt(kindDraw.value, eligibleKinds(model.player))
      return modifyFields(placePickup(model, kind, kill), {
        loot: () =>
          modifyFields(loot, {
            rngState: () => kindDraw.nextState,
            dryMs: () => 0,
            prize: () => Prize.Settled(),
          }),
      })
    },
  })
}

const settleLoot = (model: World): World =>
  Prize.isAnyOf(['Owed'])(model.loot.prize)
    ? modifyFields(model, {
        loot: loot => modifyFields(loot, { prize: () => Prize.Settled() }),
      })
    : model

const dropLoot = (before: World, model: World, worldMs: number): World =>
  Phase.match(before.phase, {
    Ready: () => settleLoot(model),
    Preparation: () => settleLoot(model),
    Wave: ({ wave }) =>
      wave === TUTORIAL_WAVE
        ? dropTutorialPickup(model, killsIn(model.frameEvents))
        : dropFromKills(
            model,
            killsIn(model.frameEvents),
            worldMs,
            before.pacing.beat,
          ),
    Paused: () => model,
    Victory: () => model,
    GameOver: () => model,
  })

// FRAME

export const advancePowerUps = (
  before: World,
  model: World,
  worldMs: number,
): World => {
  if (!isCoop(model)) {
    return isAtCounterNow(model)
      ? model
      : pipe(
          tickBoosts(model, worldMs),
          ticked => agePickups(ticked, worldMs),
          grabPickups,
          grabbed => dropLoot(before, grabbed, worldMs),
        )
  }

  return pipe(
    forEachSeat(model, seatWorld =>
      isAtCounterNow(seatWorld) ? seatWorld : tickBoosts(seatWorld, worldMs),
    ),
    ticked => agePickups(ticked, worldMs),
    aged =>
      forEachSeat(aged, seatWorld =>
        isAtCounterNow(seatWorld) || !isStanding(leadSeatOf(seatWorld))
          ? seatWorld
          : grabPickups(seatWorld),
      ),
    grabbed => dropLoot(before, grabbed, worldMs),
  )
}

// NOTE: a player at the stall's counter or an exit's offer holds still: in
// single player the whole world does, in co-op only their own boosts and
// grabs (decided row 8).
const isAtCounterNow = (model: World): boolean =>
  ShopState.isAnyOf(['Browsing'])(model.shop)
