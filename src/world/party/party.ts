import { Array, Function, Option, Result } from 'effect'

import { UiStruct } from '@effect/ui'

import { FIXED_STEP_MS } from '../../shared/constants'
import { evolveFor } from '../../shared/evolve'
import { sameIfUnchanged } from '../../shared/sameList'
import { activeModifiersOf } from '../run/dareLadder'
import { GLASS_START_HEARTS } from '../run/modifiers'
import { type World, modifyWorldFields } from '../schema/world'
import {
  type Bullet,
  Life,
  Party,
  type Player,
  type PlayerSlot,
  type Presence,
  Purchase,
  SOLO_SLOT,
  type Seat,
  type SeatState,
  type Vector,
  emptyTrapStock,
  freshTally,
  idleBoosts,
  idleIntent,
  initialPlayer,
  noCooking,
} from '../schema/worldSchema'

export const COOP_RULES = {
  waveCountScale: [1, 1.35, 1.7, 2.05],
  healthScale: [1, 1.05, 1.1, 1.15],
  bleedOutMs: 20_000,
  reviveMs: 2000,
  reviveHearts: 2,
  reviveReachPx: 16,
  revivedInvulnerableMs: 1500,
  downedCrawlScale: 0.35,
  trapLimit: 1,
  friendlyFireDamage: 1,
  maxPlayers: 4,
} as const

export const isCoop = (world: World): boolean => world.party._tag === 'Crew'

export const isFriendlyFireOn = (world: World): boolean =>
  activeModifiersOf(world).friendlyFire && world.seats.length > 1

export const soloSeat: Seat = {
  slot: SOLO_SLOT,
  life: Life.Standing(),
  presence: 'Here',
  readiness: 'Waiting',
  trapIds: [],
  kills: 0,
  revives: 0,
  downs: 0,
  shotsFired: 0,
  shotsHit: 0,
  keysFound: 0,
  graceMs: 0,
  touchedMs: 0,
}

export const soloState: SeatState = {
  seat: soloSeat,
  player: initialPlayer,
  intent: idleIntent,
  boosts: idleBoosts,
  trapStock: emptyTrapStock,
  selectedTrap: 'Barricade',
  laserSight: 'None',
  purchase: Purchase.Idle(),
  cooking: noCooking,
  feats: freshTally,
}

const MAX_BITE_GRACE_MS = 100

export const biteGraceFor = (rttMs: number): number =>
  Math.min(
    MAX_BITE_GRACE_MS,
    Math.floor(rttMs / 2 / FIXED_STEP_MS) * FIXED_STEP_MS,
  )

export const focusOf = (world: World): SeatState => world.seats[0]

export const leadSeatOf = (world: World): Seat => focusOf(world).seat

const modifySeatFields = evolveFor<SeatState>()

type SeatTransforms = Parameters<typeof modifySeatFields>[1]

const modifySeatState: {
  (transforms: SeatTransforms): <M extends SeatState>(state: M) => M
  <M extends SeatState>(state: M, transforms: SeatTransforms): M
} = Function.dual(2, modifySeatFields)

const seatIndexOf = (world: World, slot: PlayerSlot): number => {
  const { seats } = world
  if (seats[slot]?.seat.slot === slot) {
    return slot
  }
  for (let index = 0; index < seats.length; index++) {
    if (seats[index]?.seat.slot === slot) {
      return index
    }
  }
  return -1
}

const maybeSeatState = (
  world: World,
  slot: PlayerSlot,
): Option.Option<SeatState> =>
  Option.fromNullishOr(world.seats[seatIndexOf(world, slot)])

export const seatStateAt: {
  (slot: PlayerSlot): (world: World) => SeatState
  (world: World, slot: PlayerSlot): SeatState
} = Function.dual(
  2,
  (world: World, slot: PlayerSlot): SeatState =>
    world.seats[seatIndexOf(world, slot)] ?? focusOf(world),
)

export const playerAt: {
  (slot: PlayerSlot): (world: World) => Player
  (world: World, slot: PlayerSlot): Player
} = Function.dual(
  2,
  (world: World, slot: PlayerSlot): Player => seatStateAt(world, slot).player,
)

type Seats = World['seats']

export const atSeatBy: {
  (
    change: (state: SeatState) => SeatState,
  ): (slot: PlayerSlot) => (seats: Seats) => Seats
  (
    slot: PlayerSlot,
    change: (state: SeatState) => SeatState,
  ): (seats: Seats) => Seats
} = Function.dual(
  2,
  (slot: PlayerSlot, change: (state: SeatState) => SeatState) =>
    (seats: Seats): Seats =>
      sameIfUnchanged(
        seats,
        Array.map(seats, state =>
          state.seat.slot === slot ? change(state) : state,
        ),
      ),
)

export const atSeat: {
  (changes: SeatTransforms): (slot: PlayerSlot) => (seats: Seats) => Seats
  (slot: PlayerSlot, changes: SeatTransforms): (seats: Seats) => Seats
} = Function.dual(
  2,
  (slot: PlayerSlot, changes: SeatTransforms): ((seats: Seats) => Seats) =>
    atSeatBy(slot, state => modifySeatState(state, changes)),
)

export const updateSeat: {
  <M extends World>(
    slot: PlayerSlot,
    change: (state: SeatState) => SeatState,
  ): (world: M) => M
  <M extends World>(
    world: M,
    slot: PlayerSlot,
    change: (state: SeatState) => SeatState,
  ): M
} = Function.dual(
  3,
  <M extends World>(
    world: M,
    slot: PlayerSlot,
    change: (state: SeatState) => SeatState,
  ): M => modifyWorldFields(world, { seats: atSeatBy(slot, change) }),
)

export const modifySeat: {
  <M extends World>(slot: PlayerSlot, changes: SeatTransforms): (world: M) => M
  <M extends World>(world: M, slot: PlayerSlot, changes: SeatTransforms): M
} = Function.dual(
  3,
  <M extends World>(world: M, slot: PlayerSlot, changes: SeatTransforms): M =>
    modifyWorldFields(world, { seats: atSeat(slot, changes) }),
)

export const modifyFocus: {
  <M extends World>(changes: SeatTransforms): (world: M) => M
  <M extends World>(world: M, changes: SeatTransforms): M
} = Function.dual(2, <M extends World>(world: M, changes: SeatTransforms): M =>
  modifySeat(world, focusOf(world).seat.slot, changes),
)

export const focusSeat: {
  (slot: PlayerSlot): (world: World) => World
  (world: World, slot: PlayerSlot): World
} = Function.dual(2, (world: World, slot: PlayerSlot): World => {
  const index = seatIndexOf(world, slot)
  const first = world.seats[index]
  return index <= 0 || first === undefined
    ? world
    : modifyWorldFields(world, {
        seats: seats => [
          first,
          ...Array.filter(seats, (_, at) => at !== index),
        ],
      })
})

export const playerCountOf = (world: World): number => world.seats.length

export const forEachSeat: {
  (step: (current: World, slot: PlayerSlot) => World): (world: World) => World
  (world: World, step: (current: World, slot: PlayerSlot) => World): World
} = Function.dual(
  2,
  (world: World, step: (current: World, slot: PlayerSlot) => World): World => {
    if (!isCoop(world)) {
      return step(world, SOLO_SLOT)
    }
    let current = world
    for (const { seat } of world.seats) {
      current = step(current, seat.slot)
    }
    return current
  },
)

export const modifySeatRecord: {
  <M extends World>(
    slot: PlayerSlot,
    change: (seat: Seat) => Seat,
  ): (world: M) => M
  <M extends World>(world: M, slot: PlayerSlot, change: (seat: Seat) => Seat): M
} = Function.dual(
  3,
  <M extends World>(
    world: M,
    slot: PlayerSlot,
    change: (seat: Seat) => Seat,
  ): M =>
    updateSeat(world, slot, state => UiStruct.evolve(state, { seat: change })),
)

export const forEachSeatWhere: {
  (
    isIncluded: (seat: Seat) => boolean,
    step: (current: World, slot: PlayerSlot) => World,
  ): (world: World) => World
  (
    world: World,
    isIncluded: (seat: Seat) => boolean,
    step: (current: World, slot: PlayerSlot) => World,
  ): World
} = Function.dual(
  3,
  (
    world: World,
    isIncluded: (seat: Seat) => boolean,
    step: (current: World, slot: PlayerSlot) => World,
  ): World =>
    forEachSeat(world, (current, slot) =>
      isIncluded(seatStateAt(current, slot).seat)
        ? step(current, slot)
        : current,
    ),
)

export const playersOf = (world: World): ReadonlyArray<SeatState> => world.seats

export const maybePlayerAt: {
  (slot: PlayerSlot): (world: World) => Option.Option<SeatState>
  (world: World, slot: PlayerSlot): Option.Option<SeatState>
} = Function.dual(
  2,
  (world: World, slot: PlayerSlot): Option.Option<SeatState> =>
    maybeSeatState(world, slot),
)

export const isStanding = (seat: Seat): boolean => seat.life._tag === 'Standing'

export const isDowned = (seat: Seat): boolean => seat.life._tag === 'Downed'

export const isBledOut = (seat: Seat): boolean => seat.life._tag === 'BledOut'

export const isOut = (seat: Seat): boolean => seat.life._tag === 'Out'

export const isHere = (seat: Seat): boolean => seat.presence === 'Here'

export const targetsOf = (
  world: World,
): Array.NonEmptyReadonlyArray<Player> => {
  const focused = focusOf(world).player
  if (!isCoop(world)) {
    return [focused]
  }
  const standing = Array.filterMap(world.seats, ({ player, seat }) =>
    isStanding(seat) ? Result.succeed(player) : Result.failVoid,
  )
  return Array.isReadonlyArrayNonEmpty(standing) ? standing : [focused]
}

const distanceSquared = (from: Vector, to: Vector): number =>
  (from.x - to.x) * (from.x - to.x) + (from.y - to.y) * (from.y - to.y)

export const nearestOf: {
  <A extends Vector>(at: Vector): (targets: Array.NonEmptyReadonlyArray<A>) => A
  <A extends Vector>(targets: Array.NonEmptyReadonlyArray<A>, at: Vector): A
} = Function.dual(
  2,
  <A extends Vector>(targets: Array.NonEmptyReadonlyArray<A>, at: Vector): A =>
    Array.reduce(
      Array.tailNonEmpty(targets),
      Array.headNonEmpty(targets),
      (nearest, target) =>
        distanceSquared(target, at) < distanceSquared(nearest, at)
          ? target
          : nearest,
    ),
)

const nearestStandingSlot = (world: World, at: Vector): PlayerSlot => {
  let best = focusOf(world).seat.slot
  let bestDistance = Number.POSITIVE_INFINITY
  for (const { seat, player } of world.seats) {
    if (isStanding(seat)) {
      const distance = distanceSquared(player, at)
      if (distance < bestDistance) {
        best = seat.slot
        bestDistance = distance
      }
    }
  }
  return best
}

export const facingNearest: {
  (
    at: Vector,
    step: (current: World, slot: PlayerSlot) => World,
  ): (world: World) => World
  (
    world: World,
    at: Vector,
    step: (current: World, slot: PlayerSlot) => World,
  ): World
} = Function.dual(
  3,
  (
    world: World,
    at: Vector,
    step: (current: World, slot: PlayerSlot) => World,
  ): World =>
    step(
      world,
      isCoop(world) ? nearestStandingSlot(world, at) : focusOf(world).seat.slot,
    ),
)

export const withStartingHearts = (world: World): World =>
  activeModifiersOf(world).glass
    ? forEachSeat(world, (current, slot) =>
        modifySeat(current, slot, {
          player: player =>
            UiStruct.evolve(player, {
              hp: hp => Math.min(hp, GLASS_START_HEARTS),
            }),
        }),
      )
    : world

const modifyCrewSeat = (
  world: World,
  slot: PlayerSlot,
  change: (seat: Seat) => Seat,
): World => (isCoop(world) ? modifySeatRecord(world, slot, change) : world)

export const creditKills: {
  (slot: PlayerSlot, kills: number): (world: World) => World
  (world: World, slot: PlayerSlot, kills: number): World
} = Function.dual(3, (world: World, slot: PlayerSlot, kills: number): World =>
  kills > 0
    ? modifyCrewSeat(world, slot, seat =>
        UiStruct.evolve(seat, { kills: count => count + kills }),
      )
    : world,
)

export const creditRevive: {
  (slot: PlayerSlot): (world: World) => World
  (world: World, slot: PlayerSlot): World
} = Function.dual(2, (world: World, slot: PlayerSlot): World =>
  modifyCrewSeat(world, slot, seat =>
    UiStruct.evolve(seat, { revives: count => count + 1 }),
  ),
)

export const creditShots: {
  (slot: PlayerSlot, fired: number, hit: number): (world: World) => World
  (world: World, slot: PlayerSlot, fired: number, hit: number): World
} = Function.dual(
  4,
  (world: World, slot: PlayerSlot, fired: number, hit: number): World =>
    fired > 0 || hit > 0
      ? modifyCrewSeat(world, slot, seat =>
          UiStruct.evolve(seat, {
            shotsFired: count => count + fired,
            shotsHit: count => count + hit,
          }),
        )
      : world,
)

const MATE_SPACING_PX = 14

const freshSeat = (slot: PlayerSlot): Seat =>
  UiStruct.evolve(soloSeat, { slot: () => slot })

export const seatCrew: {
  (count: number): (world: World) => World
  (world: World, count: number): World
} = Function.dual(2, (world: World, count: number): World => {
  const players = Math.min(
    COOP_RULES.maxPlayers,
    Math.max(1, Math.floor(count)),
  )
  const lead = UiStruct.evolve(focusOf(world), {
    seat: () => freshSeat(SOLO_SLOT),
  })
  if (players <= 1) {
    return modifyWorldFields(world, {
      party: () => Party.Solo(),
      seats: () => [lead],
    })
  }
  const mates = Array.makeBy(players - 1, index => {
    const slot = index + 1
    const side = slot % 2 === 1 ? 1 : -1
    const step = Math.ceil(slot / 2)
    return UiStruct.evolve(lead, {
      seat: () => freshSeat(slot),
      player: player =>
        UiStruct.evolve(player, { x: x => x + side * step * MATE_SPACING_PX }),
    })
  })
  return modifyWorldFields(world, {
    party: () => Party.Crew(),
    seats: () => [lead, ...mates],
  })
})

export const presenceOf: {
  (slot: PlayerSlot): (world: World) => Presence
  (world: World, slot: PlayerSlot): Presence
} = Function.dual(2, (world: World, slot: PlayerSlot): Presence =>
  Option.match(maybeSeatState(world, slot), {
    onNone: (): Presence => 'Away',
    onSome: ({ seat }) => seat.presence,
  }),
)

export const setPresence: {
  (slot: PlayerSlot, presence: Presence): (world: World) => World
  (world: World, slot: PlayerSlot, presence: Presence): World
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, presence: Presence): World =>
    modifySeatRecord(world, slot, seat =>
      UiStruct.evolve(seat, { presence: () => presence }),
    ),
)

export const firedBy: {
  (maybeSlot: Option.Option<PlayerSlot>): (bullet: Bullet) => Bullet
  (bullet: Bullet, maybeSlot: Option.Option<PlayerSlot>): Bullet
} = Function.dual(
  2,
  (bullet: Bullet, maybeSlot: Option.Option<PlayerSlot>): Bullet =>
    Option.match(maybeSlot, {
      onNone: () => bullet,
      onSome: shooter => ({ ...bullet, shooter }),
    }),
)

export const shooterOf: {
  (slot: PlayerSlot): (world: World) => Option.Option<PlayerSlot>
  (world: World, slot: PlayerSlot): Option.Option<PlayerSlot>
} = Function.dual(
  2,
  (world: World, slot: PlayerSlot): Option.Option<PlayerSlot> =>
    isCoop(world) ? Option.some(slot) : Option.none(),
)

export const maybeShooterOf = (bullet: Bullet): Option.Option<PlayerSlot> =>
  Option.fromNullishOr(bullet.shooter)

export const trapOwnerOf: {
  (trapId: number): (world: World) => Option.Option<PlayerSlot>
  (world: World, trapId: number): Option.Option<PlayerSlot>
} = Function.dual(
  2,
  (world: World, trapId: number): Option.Option<PlayerSlot> =>
    isCoop(world)
      ? Option.map(
          Array.findFirst(world.seats, ({ seat }) =>
            Array.contains(seat.trapIds, trapId),
          ),
          ({ seat }) => seat.slot,
        )
      : Option.none(),
)

export const focusSlotOf = (world: World): PlayerSlot =>
  focusOf(world).seat.slot
