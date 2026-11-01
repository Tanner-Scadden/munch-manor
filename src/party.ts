import { Array, Option, Order, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { killPayFor } from './calling'
import { FIXED_STEP_MS } from './constants'
import type { World } from './world'
import {
  type Bullet,
  type Intent,
  Life,
  type Mate,
  Party,
  type Player,
  type PlayerSlot,
  type Presence,
  SOLO_SLOT,
  type Seat,
  type ShopState,
  type Vector,
  type Wallet,
} from './worldSchema'

// The players of a World (MULTIPLAYER.md, Phase 1). Single player is Solo:
// its one player is the World's own per-player fields, exactly as before.
// A Crew keeps one seat, the lead, in those fields and the rest as Mates;
// every per-player system runs on each seat in turn by swapping it in, so
// the systems keep reading `world.player`, `world.wallet`, and the rest.

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
  maxPlayers: 4,
} as const

// SEATS

export const isCoop = (world: World): boolean =>
  Party.isAnyOf(['Crew'])(world.party)

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

const MAX_BITE_GRACE_MS = 100

// NOTE: the bite grace for a round trip, in whole ticks so it only
// changes when it matters.
export const biteGraceFor = (rttMs: number): number =>
  Math.min(
    MAX_BITE_GRACE_MS,
    Math.floor(rttMs / 2 / FIXED_STEP_MS) * FIXED_STEP_MS,
  )

export const leadSeatOf = (world: World): Seat =>
  Party.match(world.party, {
    Solo: () => soloSeat,
    Crew: ({ lead }) => lead,
  })

const matesOf = (world: World): ReadonlyArray<Mate> =>
  Party.match(world.party, {
    Solo: () => [],
    Crew: ({ mates }) => mates,
  })

const mateOfLead = (world: World, seat: Seat): Mate => ({
  seat,
  player: world.player,
  intent: world.intent,
  wallet: world.wallet,
  boosts: world.boosts,
  trapStock: world.trapStock,
  selectedTrap: world.selectedTrap,
  shop: world.shop,
  shopCategory: world.shopCategory,
  laserSight: world.laserSight,
  purchase: world.purchase,
})

// NOTE: puts mate `index` in the World's per-player fields and the lead in
// its place among the mates. Swapping the same index again undoes it.
const swapIn = (world: World, index: number): World =>
  Party.match(world.party, {
    Solo: () => world,
    Crew: ({ lead, mates }) =>
      Option.match(Array.get(mates, index), {
        onNone: () => world,
        onSome: mate =>
          modifyFields(world, {
            player: () => mate.player,
            intent: () => mate.intent,
            wallet: () => mate.wallet,
            boosts: () => mate.boosts,
            trapStock: () => mate.trapStock,
            selectedTrap: () => mate.selectedTrap,
            shop: () => mate.shop,
            shopCategory: () => mate.shopCategory,
            laserSight: () => mate.laserSight,
            purchase: () => mate.purchase,
            party: () =>
              Party.Crew({
                lead: mate.seat,
                mates: Array.map(mates, (other, at) =>
                  at === index ? mateOfLead(world, lead) : other,
                ),
              }),
          }),
      }),
  })

const mateIndexOf = (world: World, slot: PlayerSlot): Option.Option<number> =>
  Array.findFirstIndex(matesOf(world), mate => mate.seat.slot === slot)

// NOTE: runs `step` with the seat at `slot` in the World's per-player
// fields, then puts the lead back. A slot not in the World is left alone.
export const withSeat = (
  world: World,
  slot: PlayerSlot,
  step: (seatWorld: World) => World,
): World => {
  if (leadSeatOf(world).slot === slot) {
    return step(world)
  }
  return Option.match(mateIndexOf(world, slot), {
    onNone: () => world,
    onSome: index => swapIn(step(swapIn(world, index)), index),
  })
}

// NOTE: keeps the seat at `slot` in the World's per-player fields, for a
// client that draws its own player there.
export const focusSeat = (world: World, slot: PlayerSlot): World =>
  Option.match(mateIndexOf(world, slot), {
    onNone: () => world,
    onSome: index => swapIn(world, index),
  })

export const slotsOf = (world: World): ReadonlyArray<PlayerSlot> =>
  Array.sort(
    [
      leadSeatOf(world).slot,
      ...Array.map(matesOf(world), ({ seat }) => seat.slot),
    ],
    Order.Number,
  )

export const playerCountOf = (world: World): number => 1 + matesOf(world).length

// NOTE: every seat in slot order, each with itself in the per-player
// fields. Single player is one call on the World as it is.
export const forEachSeat = (
  world: World,
  step: (seatWorld: World, slot: PlayerSlot) => World,
): World =>
  isCoop(world)
    ? Array.reduce(slotsOf(world), world, (current, slot) =>
        withSeat(current, slot, seatWorld => step(seatWorld, slot)),
      )
    : step(world, SOLO_SLOT)

export const modifyLeadSeat = (
  world: World,
  change: (seat: Seat) => Seat,
): World =>
  Party.match(world.party, {
    Solo: () => world,
    Crew: ({ lead, mates }) =>
      modifyFields(world, {
        party: () => Party.Crew({ lead: change(lead), mates }),
      }),
  })

// NOTE: a step for each seat that `isIncluded` lets in, the rest left as
// they are.
export const forEachSeatWhere = (
  world: World,
  isIncluded: (seat: Seat) => boolean,
  step: (seatWorld: World, slot: PlayerSlot) => World,
): World =>
  forEachSeat(world, (seatWorld, slot) =>
    isIncluded(leadSeatOf(seatWorld)) ? step(seatWorld, slot) : seatWorld,
  )

// READING THE PLAYERS

export type SeatedPlayer = Readonly<{
  slot: PlayerSlot
  player: Player
  seat: Seat
  wallet: Wallet
  intent: Intent
}>

export const playersOf = (world: World): ReadonlyArray<SeatedPlayer> =>
  Array.sort(
    [
      {
        slot: leadSeatOf(world).slot,
        player: world.player,
        seat: leadSeatOf(world),
        wallet: world.wallet,
        intent: world.intent,
      },
      ...Array.map(matesOf(world), mate => ({
        slot: mate.seat.slot,
        player: mate.player,
        seat: mate.seat,
        wallet: mate.wallet,
        intent: mate.intent,
      })),
    ],
    Order.mapInput(Order.Number, ({ slot }: SeatedPlayer) => slot),
  )

export const maybePlayerAt = (
  world: World,
  slot: PlayerSlot,
): Option.Option<SeatedPlayer> =>
  Array.findFirst(playersOf(world), player => player.slot === slot)

export const isStanding = (seat: Seat): boolean =>
  Life.isAnyOf(['Standing'])(seat.life)

export const isDowned = (seat: Seat): boolean =>
  Life.isAnyOf(['Downed'])(seat.life)

export const isBledOut = (seat: Seat): boolean =>
  Life.isAnyOf(['BledOut'])(seat.life)

export const isHere = (seat: Seat): boolean => seat.presence === 'Here'

const standingOrLead = (
  world: World,
  standing: ReadonlyArray<Player>,
): Array.NonEmptyReadonlyArray<Player> =>
  Array.isReadonlyArrayNonEmpty(standing) ? standing : [world.player]

// NOTE: who the zombies hunt: every standing player, here or away. Single
// player is always its one player, as before.
export const targetsOf = (world: World): Array.NonEmptyReadonlyArray<Player> =>
  isCoop(world)
    ? standingOrLead(
        world,
        Array.filterMap(playersOf(world), ({ player, seat }) =>
          isStanding(seat) ? Result.succeed(player) : Result.failVoid,
        ),
      )
    : [world.player]

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
const nearestStandingSlot = (world: World, at: Vector): PlayerSlot =>
  pipe(
    playersOf(world),
    Array.filter(({ seat }) => isStanding(seat)),
    Array.match({
      onEmpty: () => leadSeatOf(world).slot,
      onNonEmpty: standing =>
        nearestOf(
          Array.map(standing, ({ slot, player }) => ({
            slot,
            x: player.x,
            y: player.y,
          })),
          at,
        ).slot,
    }),
  )

// NOTE: runs a system that fights one player with the standing player
// nearest `at` in the per-player fields.
export const facingNearest = (
  world: World,
  at: Vector,
  step: (seatWorld: World) => World,
): World =>
  isCoop(world)
    ? withSeat(world, nearestStandingSlot(world, at), step)
    : step(world)

// MONEY

export const earn = (wallet: Wallet, amount: number): Wallet =>
  modifyFields(wallet, {
    balance: balance => balance + amount,
    earned: earned => earned + amount,
  })

const earnInWorld = (world: World, amount: number): World =>
  modifyFields(world, { wallet: wallet => earn(wallet, amount) })

// NOTE: kill money for the player standing in the World's per-player
// fields, as their calling pays it (the Penny Pincher's kills pay less).
// A bonus is not a kill, so it goes through earnInWorld whole.
export const earnKill = (world: World, amount: number): World =>
  earnInWorld(world, killPayFor(world.player.calling, amount))

// NOTE: kill money goes to the killer (decided 5). A kill with no single
// killer, such as a Kaboomer's chain or an oven's fire, is shared.
export const payTo = (
  world: World,
  maybeSlot: Option.Option<PlayerSlot>,
  amount: number,
): World =>
  Option.match(maybeSlot, {
    onNone: () => payShared(world, amount),
    onSome: slot =>
      isCoop(world)
        ? withSeat(world, slot, seatWorld => earnKill(seatWorld, amount))
        : earnKill(world, amount),
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
  earnWith: (seatWorld: World, amount: number) => World,
): World => {
  if (!isCoop(world)) {
    return earnWith(world, amount)
  }
  const slots = slotsOf(world)
  const share = Math.floor(amount / slots.length)
  const odd = amount - share * slots.length
  return Array.reduce(slots, world, (current, slot) => {
    const order = Option.getOrElse(
      Array.findFirstIndex(slots, s => s === slot),
      () => 0,
    )
    return withSeat(current, slot, seatWorld =>
      earnWith(seatWorld, share + (order < odd ? 1 : 0)),
    )
  })
}

// NOTE: a change to the seat at `slot`, wherever it sits.
const modifySeatAt = (
  world: World,
  slot: PlayerSlot,
  change: (seat: Seat) => Seat,
): World =>
  withSeat(world, slot, seatWorld => modifyLeadSeat(seatWorld, change))

export const creditKills = (
  world: World,
  slot: PlayerSlot,
  kills: number,
): World =>
  kills > 0
    ? modifySeatAt(world, slot, seat =>
        modifyFields(seat, { kills: count => count + kills }),
      )
    : world

export const creditRevive = (world: World, slot: PlayerSlot): World =>
  modifySeatAt(world, slot, seat =>
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
  isCoop(world) && (fired > 0 || hit > 0)
    ? modifySeatAt(world, slot, seat =>
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
  if (players <= 1) {
    return modifyFields(world, { party: () => Party.Solo() })
  }
  const mates = Array.makeBy(players - 1, index => {
    const slot = index + 1
    const side = slot % 2 === 1 ? 1 : -1
    const step = Math.ceil(slot / 2)
    return modifyFields(mateOfLead(world, freshSeat(slot)), {
      player: player =>
        modifyFields(player, { x: x => x + side * step * MATE_SPACING_PX }),
    })
  })
  return modifyFields(world, {
    party: () => Party.Crew({ lead: freshSeat(SOLO_SLOT), mates }),
  })
}

export const presenceOf = (world: World, slot: PlayerSlot): Presence =>
  Option.match(maybePlayerAt(world, slot), {
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
  withSeat(world, slot, seatWorld =>
    modifyLeadSeat(seatWorld, seat =>
      modifyFields(seat, { presence: () => presence }),
    ),
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

export const shooterOf = (world: World): Option.Option<PlayerSlot> =>
  isCoop(world) ? Option.some(leadSeatOf(world).slot) : Option.none()

export const maybeShooterOf = (bullet: Bullet): Option.Option<PlayerSlot> =>
  Option.fromNullishOr(bullet.shooter)

export const trapOwnerOf = (
  world: World,
  trapId: number,
): Option.Option<PlayerSlot> =>
  isCoop(world)
    ? Option.map(
        Array.findFirst(playersOf(world), ({ seat }) =>
          Array.contains(seat.trapIds, trapId),
        ),
        ({ slot }) => slot,
      )
    : Option.none()

// NOTE: a seat's own stall or exit state, wherever the seat sits.
export const shopOf = (
  world: World,
  slot: PlayerSlot,
): Option.Option<ShopState> =>
  leadSeatOf(world).slot === slot
    ? Option.some(world.shop)
    : Option.map(
        Array.findFirst(matesOf(world), mate => mate.seat.slot === slot),
        ({ shop }) => shop,
      )
