import { Array, Function, Option, Record, Result, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { PLAYER_RADIUS, PLAYER_SPEED } from '../../shared/constants'
import { nextRandom } from '../../shared/prng'
import type { SoundEffect } from '../../shared/soundEffect'
import { maxHpOf, speedScaleOf } from '../heroes/calling'
import { type Level, type Room, levelOf, roomAt } from '../level/arena'
import { type Box, circleTouchesBox } from '../level/tileGrid'
import { isSolidAt } from '../level/tileQueries'
import { PICKUP_NAMES } from '../names'
import {
  atSeat,
  focusOf,
  forEachSeat,
  isCoop,
  isStanding,
  seatStateAt,
} from '../party/party'
import type { Modifiers } from '../run/modifiers'
import { totalKills } from '../run/stats'
import type { World } from '../schema/world'
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
  type PlayerSlot,
  Prize,
  SOLO_SLOT,
  type Vector,
  type WeaponKind,
  type ZombieKind,
} from '../schema/worldSchema'
import { type BlastSpec, ZOMBIE_BLAST_TARGET, blastAll } from '../step/combat'
import { trapBlockers } from './traps'
import {
  type WeaponStats,
  canReload,
  finishReload,
  isReloading,
  statsAt,
} from './weapons'

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
  Heal: { hearts: Schema.Finite },
})
type PickupEffect = typeof PickupEffect.Type

type PickupStats = Readonly<{
  name: string
  blurb: string
  weight: number
  effect: PickupEffect
  sound: SoundEffect
}>

export const PICKUPS: Readonly<Record<PickupKind, PickupStats>> = {
  RapidFire: {
    name: PICKUP_NAMES.RapidFire,
    blurb: 'WOUND UP! NO RELOADS',
    weight: 24,
    effect: PickupEffect.Boost({ boost: 'RapidFire' }),
    sound: 'GrabHotSauce',
  },
  Damage: {
    name: PICKUP_NAMES.Damage,
    blurb: 'FANCY! DOUBLE DAMAGE',
    weight: 22,
    effect: PickupEffect.Boost({ boost: 'Damage' }),
    sound: 'GrabMeanBeans',
  },
  Speed: {
    name: PICKUP_NAMES.Speed,
    blurb: 'CHA-CHA! RUN FASTER',
    weight: 16,
    effect: PickupEffect.Boost({ boost: 'Speed' }),
    sound: 'GrabZoomySocks',
  },
  Pierce: {
    name: PICKUP_NAMES.Pierce,
    blurb: 'SHOTS POKE THROUGH',
    weight: 20,
    effect: PickupEffect.Boost({ boost: 'Pierce' }),
    sound: 'GrabKebullets',
  },
  Burp: {
    name: PICKUP_NAMES.Burp,
    blurb: 'BONG! EVERYBODY BACK!',
    weight: 10,
    effect: PickupEffect.Burp(),
    sound: 'GrabBurp',
  },
  Heart: {
    name: PICKUP_NAMES.Heart,
    blurb: '+1 HEART',
    weight: 8,
    effect: PickupEffect.Heal({ hearts: 1 }),
    sound: 'GrabHeart',
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

// NOTE: a gun's level up (src/world/gear/gunLevels.ts) pops big and short,
// as long as a first grab, so its name and change line can be read.
export const LEVEL_CALLOUT_LIFETIME_MS = 1600

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

export const isBoosted: {
  (kind: BoostKind): (boosts: Boosts) => boolean
  (boosts: Boosts, kind: BoostKind): boolean
} = Function.dual(2, (boosts: Boosts, kind: BoostKind): boolean =>
  isOn(boosts[kind]),
)

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

export const firingStats: {
  (kind: WeaponKind, tier: number): (boosts: Boosts) => WeaponStats
  (boosts: Boosts, kind: WeaponKind, tier: number): WeaponStats
} = Function.dual(
  3,
  (boosts: Boosts, kind: WeaponKind, tier: number): WeaponStats =>
    boostWeapon(statsAt(kind, tier), boosts),
)

export const playerSpeed: {
  (player: Player): (boosts: Boosts) => number
  (boosts: Boosts, player: Player): number
} = Function.dual(
  2,
  (boosts: Boosts, player: Player): number =>
    PLAYER_SPEED *
    speedScaleOf(player) *
    productOf(boosts, ({ speedScale }) => speedScale),
)

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

export const keepTopped: {
  (boosts: Boosts): (player: Player) => Player
  (player: Player, boosts: Boosts): Player
} = Function.dual(2, (player: Player, boosts: Boosts): Player =>
  isAmmoFree(boosts) && (isReloading(player) || canReload(player))
    ? finishReload(player)
    : player,
)

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

// NOTE: a boost's clock runs only while a wave is on, so one grabbed late in
// a wave carries over the break to the next (owner, 2026-11-02).
const tickBoosts = (model: World, slot: PlayerSlot, deltaMs: number): World => {
  const { boosts: before, player } = seatStateAt(model, slot)
  if (
    !Phase.isAnyOf(['Wave'])(model.phase) ||
    !Array.some(BOOST_KIND_ORDER, kind => isOn(before[kind]))
  ) {
    return model
  }

  const boosts: Boosts = Record.map(before, timer => tickTimer(timer, deltaMs))
  const faded = Array.filter(
    BOOST_KIND_ORDER,
    kind => isOn(before[kind]) && !isOn(boosts[kind]),
  )
  return modifyFields(model, {
    seats: atSeat(slot, { boosts: () => boosts }),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.map(faded, kind =>
        GameEvent.BoostFaded({ x: player.x, y: player.y, kind }),
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
    frameEvents: frameEvents => [
      ...frameEvents,
      GameEvent.Burped({ x: at.x, y: at.y, radius: BURP_RADIUS }),
      ...outcome.events,
    ],
  })
}

const applyEffect = (
  model: World,
  slot: PlayerSlot,
  effect: PickupEffect,
): World =>
  PickupEffect.match(effect, {
    Boost: ({ boost }) => {
      const boosts: Boosts = Record.map(
        seatStateAt(model, slot).boosts,
        (timer, kind) =>
          kind === boost ? extendTimer(timer, BOOSTS[boost].durationMs) : timer,
      )
      return modifyFields(model, {
        seats: atSeat(slot, {
          boosts: () => boosts,
          player: player => keepTopped(player, boosts),
        }),
      })
    },
    Burp: () => burpAt(model, seatStateAt(model, slot).player),
    Heal: ({ hearts }) =>
      modifyFields(model, {
        seats: atSeat(slot, {
          player: player =>
            modifyFields(player, {
              hp: hp => Math.min(maxHpOf(player), hp + hearts),
            }),
        }),
      }),
  })

const grab = (model: World, slot: PlayerSlot, pickup: Pickup): World =>
  modifyFields(applyEffect(model, slot, PICKUPS[pickup.kind].effect), {
    frameEvents: Array.append(
      GameEvent.PickupGrabbed({ x: pickup.x, y: pickup.y, kind: pickup.kind }),
    ),
  })

const grabPickups = (model: World, slot: PlayerSlot): World => {
  if (Array.isReadonlyArrayEmpty(model.pickups)) {
    return model
  }

  const { player } = seatStateAt(model, slot)
  const [grabbed, left] = Array.partition(
    model.pickups,
    (pickup): Result.Result<Pickup, Pickup> =>
      isWithinGrab(player)(pickup)
        ? Result.succeed(pickup)
        : Result.fail(pickup),
  )
  if (Array.isReadonlyArrayEmpty(grabbed)) {
    return model
  }

  const landed: World = modifyFields(model, { pickups: () => left })
  return Array.reduce(grabbed, landed, (current, pickup) =>
    grab(current, slot, pickup),
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

// NOTE: a heart drops only for a player who has lost one, and never in a
// Glass run (src/world/run/modifiers.ts), where hearts come from Rattles alone.
const eligibleKinds = (
  player: Player,
  modifiers: Modifiers,
): ReadonlyArray<PickupKind> =>
  Array.filter(
    PICKUP_KIND_ORDER,
    kind =>
      !PickupEffect.isAnyOf(['Heal'])(PICKUPS[kind].effect) ||
      (!modifiers.glass && player.hp < maxHpOf(player)),
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
      const kind = pickKindAt(
        kindDraw.value,
        eligibleKinds(focusOf(model).player, model.modifiers),
      )
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
    Arriving: () => settleLoot(model),
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
    Escaped: () => model,
    LeftEarly: () => model,
    GameOver: () => model,
  })

// FRAME

// NOTE: a player at the stall's counter or an exit's offer holds still: in
// single player the whole world does, in co-op only their own boosts and
// grabs (decided row 8).
export const advancePowerUps: {
  (model: World, worldMs: number): (before: World) => World
  (before: World, model: World, worldMs: number): World
} = Function.dual(3, (before: World, model: World, worldMs: number): World => {
  if (!isCoop(model)) {
    return pipe(
      tickBoosts(model, SOLO_SLOT, worldMs),
      ticked => agePickups(ticked, worldMs),
      grabbed => grabPickups(grabbed, SOLO_SLOT),
      grabbed => dropLoot(before, grabbed, worldMs),
    )
  }

  return pipe(
    forEachSeat(model, (current, slot) => tickBoosts(current, slot, worldMs)),
    ticked => agePickups(ticked, worldMs),
    aged =>
      forEachSeat(aged, (current, slot) => {
        const { seat } = seatStateAt(current, slot)
        return isStanding(seat) ? grabPickups(current, slot) : current
      }),
    grabbed => dropLoot(before, grabbed, worldMs),
  )
})
