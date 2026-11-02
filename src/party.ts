import { Array, Option, Order, Result } from 'effect'
import { makeModifyFieldsFor, modifyFields } from 'foldkit/struct'

import { killPayFor } from './calling'
import { FIXED_STEP_MS } from './constants'
import { type World, modifyWorldFields } from './world'
import {
  type Bullet,
  FIRST_SHOP_CATEGORY,
  Life,
  Party,
  type Player,
  type PlayerSlot,
  type Presence,
  Purchase,
  SOLO_SLOT,
  type Seat,
  type SeatState,
  ShopState,
  type Vector,
  type Wallet,
  emptyTrapStock,
  emptyWallet,
  idleBoosts,
  idleIntent,
  initialPlayer,
} from './worldSchema'

// The players of a World (MULTIPLAYER.md, Phase 1). Every player has a
// SeatState in the World's `seats`, in slot order, and a per-player system
// reads and writes its player by slot. Single player is one seat at
// SOLO_SLOT; a Party of Crew plays by co-op's rules, bots included.
//
// A client draws its own seat first (`focusSeat`), so `focusOf` is the
// player a screen is about: the only seat in single player, your own in a
// room. The room's own World is always in slot order.

// RULES

// NOTE: co-op's starting values (MULTIPLAYER.md, "Decided"), for the
// multi-bot balance pass to tune. Index 0 is one player.
export const COOP_RULES = {
  waveCountScale: [1, 1.6, 2.2, 2.8],
  healthScale: [1, 1.1, 1.2, 1.3],
  bleedOutMs: 10_000,
  reviveMs: 2000,
  reviveHearts: 2,
  reviveReachPx: 16,
  revivedInvulnerableMs: 1500,
  downedCrawlScale: 0.35,
  trapLimit: 1,
  friendlyFireDamage: 1,
  isFriendlyFireOn: false,
  maxPlayers: 4,
} as const

// SEATS

export const isCoop = (world: World): boolean => world.party._tag === 'Crew'

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
  graceMs: 0,
  touchedMs: 0,
}

// NOTE: the one seat single player starts a run with.
export const soloState: SeatState = {
  seat: soloSeat,
  player: initialPlayer,
  intent: idleIntent,
  wallet: emptyWallet,
  boosts: idleBoosts,
  trapStock: emptyTrapStock,
  selectedTrap: 'Barricade',
  shop: ShopState.Away(),
  shopCategory: FIRST_SHOP_CATEGORY,
  laserSight: 'None',
  purchase: Purchase.Idle(),
}

const MAX_BITE_GRACE_MS = 100

// NOTE: the bite grace for a round trip, in whole ticks so it only
// changes when it matters.
export const biteGraceFor = (rttMs: number): number =>
  Math.min(
    MAX_BITE_GRACE_MS,
    Math.floor(rttMs / 2 / FIXED_STEP_MS) * FIXED_STEP_MS,
  )

// NOTE: the seat a screen is about: the first in `seats`, which is the only
// one in single player and your own in a co-op client's drawn World.
export const focusOf = (world: World): SeatState => world.seats[0]

export const leadSeatOf = (world: World): Seat => focusOf(world).seat

export const modifySeatState = makeModifyFieldsFor<SeatState>()

// NOTE: where the seat at `slot` sits in `seats`, or -1. A room's seats are
// in slot order and dense, so the slot is usually the index.
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

// NOTE: the state of the seat at `slot`. A slot the World has no seat for
// reads the focused seat, so callers check `maybePlayerAt` for a slot they were
// handed; the systems only ever ask for slots they got from the World.
export const seatStateAt = (world: World, slot: PlayerSlot): SeatState =>
  world.seats[seatIndexOf(world, slot)] ?? focusOf(world)

export const playerAt = (world: World, slot: PlayerSlot): Player =>
  seatStateAt(world, slot).player

type Seats = World['seats']

// NOTE: the `seats` transform that changes the seat at `slot` and leaves
// the others, for a `modifyFields` that also changes other World fields:
// `modifyFields(world, { bullets: ..., seats: atSeat(slot, { player: ... }) })`.
// A slot not in the World changes nothing.
export const atSeatBy =
  (slot: PlayerSlot, change: (state: SeatState) => SeatState) =>
  (seats: Seats): Seats =>
    Array.map(seats, state =>
      state.seat.slot === slot ? change(state) : state,
    )

export const atSeat = (
  slot: PlayerSlot,
  changes: Parameters<typeof modifySeatState>[1],
) => atSeatBy(slot, state => modifySeatState(state, changes))

// NOTE: a change to the seat at `slot`, the rest of the World as it was.
export const updateSeat = <M extends World>(
  world: M,
  slot: PlayerSlot,
  change: (state: SeatState) => SeatState,
): M => modifyWorldFields(world, { seats: atSeatBy(slot, change) })

export const modifySeat = <M extends World>(
  world: M,
  slot: PlayerSlot,
  changes: Parameters<typeof modifySeatState>[1],
): M => modifyWorldFields(world, { seats: atSeat(slot, changes) })

// NOTE: the same for the seat a screen is about.
export const modifyFocus = <M extends World>(
  world: M,
  changes: Parameters<typeof modifySeatState>[1],
): M => modifySeat(world, focusOf(world).seat.slot, changes)

// NOTE: puts the seat at `slot` first, the others in the order they were,
// for a client that draws its own player. A slot not in the World leaves
// it as it is.
export const focusSeat = (world: World, slot: PlayerSlot): World => {
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
}

export const slotsOf = (world: World): ReadonlyArray<PlayerSlot> =>
  Array.sort(
    Array.map(world.seats, ({ seat }) => seat.slot),
    Order.Number,
  )

export const playerCountOf = (world: World): number => world.seats.length

// NOTE: every seat in the order it sits (slot order in a room), each with
// `step`, which gets the World as the seats before it left it. Single
// player is one call.
export const forEachSeat = (
  world: World,
  step: (current: World, slot: PlayerSlot) => World,
): World => {
  if (!isCoop(world)) {
    return step(world, SOLO_SLOT)
  }
  let current = world
  for (const { seat } of world.seats) {
    current = step(current, seat.slot)
  }
  return current
}

// NOTE: a change to the seat's record at `slot`.
export const modifySeatRecord = <M extends World>(
  world: M,
  slot: PlayerSlot,
  change: (seat: Seat) => Seat,
): M => updateSeat(world, slot, state => modifyFields(state, { seat: change }))

// NOTE: a step for each seat that `isIncluded` lets in, the rest left as
// they are.
export const forEachSeatWhere = (
  world: World,
  isIncluded: (seat: Seat) => boolean,
  step: (current: World, slot: PlayerSlot) => World,
): World =>
  forEachSeat(world, (current, slot) =>
    isIncluded(seatStateAt(current, slot).seat) ? step(current, slot) : current,
  )

// READING THE PLAYERS

export const playersOf = (world: World): ReadonlyArray<SeatState> => world.seats

export const maybePlayerAt = (
  world: World,
  slot: PlayerSlot,
): Option.Option<SeatState> => maybeSeatState(world, slot)

export const isStanding = (seat: Seat): boolean => seat.life._tag === 'Standing'

export const isDowned = (seat: Seat): boolean => seat.life._tag === 'Downed'

export const isBledOut = (seat: Seat): boolean => seat.life._tag === 'BledOut'

export const isHere = (seat: Seat): boolean => seat.presence === 'Here'

// NOTE: who the zombies hunt: every standing player, here or away. Single
// player is always its one player, as before.
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

// NOTE: the nearest of the targets to a point, the first on a tie.
export const nearestOf = <A extends Vector>(
  targets: Array.NonEmptyReadonlyArray<A>,
  at: Vector,
): A =>
  Array.reduce(
    Array.tailNonEmpty(targets),
    Array.headNonEmpty(targets),
    (nearest, target) =>
      distanceSquared(target, at) < distanceSquared(nearest, at)
        ? target
        : nearest,
  )

// NOTE: the slot of the standing player nearest a point, for the systems
// that fight one player at a time (the boss, a Big Leaguer, an Ankle Biter).
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

// NOTE: runs a system that fights one player with the standing player
// nearest `at`.
export const facingNearest = (
  world: World,
  at: Vector,
  step: (current: World, slot: PlayerSlot) => World,
): World =>
  step(
    world,
    isCoop(world) ? nearestStandingSlot(world, at) : focusOf(world).seat.slot,
  )

// MONEY

export const earn = (wallet: Wallet, amount: number): Wallet =>
  modifyFields(wallet, {
    balance: balance => balance + amount,
    earned: earned => earned + amount,
  })

const earnInWorld = (world: World, slot: PlayerSlot, amount: number): World =>
  modifySeat(world, slot, { wallet: wallet => earn(wallet, amount) })

// NOTE: kill money for the player at `slot`, as their calling pays it (the
// Penny Pincher's kills pay less). A bonus is not a kill, so it goes
// through earnInWorld whole.
export const earnKill = (
  world: World,
  slot: PlayerSlot,
  amount: number,
): World =>
  earnInWorld(
    world,
    slot,
    killPayFor(seatStateAt(world, slot).player.calling, amount),
  )

// NOTE: kill money goes to the killer (decided 5). A kill with no single
// killer, such as a Kaboomer's chain or an oven's fire, is shared.
export const payTo = (
  world: World,
  maybeSlot: Option.Option<PlayerSlot>,
  amount: number,
): World =>
  Option.match(maybeSlot, {
    onNone: () => payShared(world, amount),
    onSome: slot => earnKill(world, isCoop(world) ? slot : SOLO_SLOT, amount),
  })

// NOTE: a bonus split evenly among the players (decided 5): whole dollars,
// with the odd ones to the lowest seats, so the split adds up to the bonus.
export const payShared = (world: World, amount: number): World =>
  splitAmong(world, amount, earnInWorld)

// NOTE: kill money with no single killer (a Kaboomer's chain, an oven's
// fire, a trap's blast), split the same way, each player paid as their own
// calling pays kills.
export const payKillShared = (world: World, amount: number): World =>
  splitAmong(world, amount, earnKill)

const splitAmong = (
  world: World,
  amount: number,
  earnWith: (current: World, slot: PlayerSlot, amount: number) => World,
): World => {
  if (!isCoop(world)) {
    return earnWith(world, SOLO_SLOT, amount)
  }
  const slots = slotsOf(world)
  const share = Math.floor(amount / slots.length)
  const odd = amount - share * slots.length
  return Array.reduce(slots, world, (current, slot, order) =>
    earnWith(current, slot, share + (order < odd ? 1 : 0)),
  )
}

// NOTE: a change to the seat's record at `slot`, in co-op only: single
// player counts its own in the run stats.
const modifyCrewSeat = (
  world: World,
  slot: PlayerSlot,
  change: (seat: Seat) => Seat,
): World => (isCoop(world) ? modifySeatRecord(world, slot, change) : world)

export const creditKills = (
  world: World,
  slot: PlayerSlot,
  kills: number,
): World =>
  kills > 0
    ? modifyCrewSeat(world, slot, seat =>
        modifyFields(seat, { kills: count => count + kills }),
      )
    : world

export const creditRevive = (world: World, slot: PlayerSlot): World =>
  modifyCrewSeat(world, slot, seat =>
    modifyFields(seat, { revives: count => count + 1 }),
  )

// NOTE: shots fired and landed by the seat at `slot`, for its aim on the
// crew board. Single player counts its own in the run stats.
export const creditShots = (
  world: World,
  slot: PlayerSlot,
  fired: number,
  hit: number,
): World =>
  fired > 0 || hit > 0
    ? modifyCrewSeat(world, slot, seat =>
        modifyFields(seat, {
          shotsFired: count => count + fired,
          shotsHit: count => count + hit,
        }),
      )
    : world

// CREW

const MATE_SPACING_PX = 14

const freshSeat = (slot: PlayerSlot): Seat =>
  modifyFields(soloSeat, { slot: () => slot })

// NOTE: a new run's crew: the lead at slot 0 where single player starts,
// and each teammate beside them, with their own copy of every per-player
// field as the lead has it.
export const seatCrew = (world: World, count: number): World => {
  const players = Math.min(
    COOP_RULES.maxPlayers,
    Math.max(1, Math.floor(count)),
  )
  const lead = modifyFields(focusOf(world), {
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
    return modifyFields(lead, {
      seat: () => freshSeat(slot),
      player: player =>
        modifyFields(player, { x: x => x + side * step * MATE_SPACING_PX }),
    })
  })
  return modifyWorldFields(world, {
    party: () => Party.Crew(),
    seats: () => [lead, ...mates],
  })
}

export const presenceOf = (world: World, slot: PlayerSlot): Presence =>
  Option.match(maybeSeatState(world, slot), {
    onNone: (): Presence => 'Away',
    onSome: ({ seat }) => seat.presence,
  })

// NOTE: the room marks a player Away after 3 s with no input and Here again
// once they send one (decided row 10).
export const setPresence = (
  world: World,
  slot: PlayerSlot,
  presence: Presence,
): World =>
  modifySeatRecord(world, slot, seat =>
    modifyFields(seat, { presence: () => presence }),
  )

// CREDIT

// NOTE: marks a bullet with who fired it. Single player leaves it unmarked.
export const firedBy = (
  bullet: Bullet,
  maybeSlot: Option.Option<PlayerSlot>,
): Bullet =>
  Option.match(maybeSlot, {
    onNone: () => bullet,
    onSome: shooter => ({ ...bullet, shooter }),
  })

export const shooterOf = (
  world: World,
  slot: PlayerSlot,
): Option.Option<PlayerSlot> =>
  isCoop(world) ? Option.some(slot) : Option.none()

export const maybeShooterOf = (bullet: Bullet): Option.Option<PlayerSlot> =>
  Option.fromNullishOr(bullet.shooter)

export const trapOwnerOf = (
  world: World,
  trapId: number,
): Option.Option<PlayerSlot> =>
  isCoop(world)
    ? Option.map(
        Array.findFirst(world.seats, ({ seat }) =>
          Array.contains(seat.trapIds, trapId),
        ),
        ({ seat }) => seat.slot,
      )
    : Option.none()

// NOTE: a seat's own stall or exit state, wherever the seat sits.
export const shopOf = (
  world: World,
  slot: PlayerSlot,
): Option.Option<ShopState> =>
  Option.map(maybeSeatState(world, slot), ({ shop }) => shop)

// NOTE: the slot of the seat a screen is about.
export const focusSlotOf = (world: World): PlayerSlot =>
  focusOf(world).seat.slot
