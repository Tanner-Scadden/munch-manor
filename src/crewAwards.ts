import { Array, Option, Order, Result, pipe } from 'effect'

import type { Model } from './model'
import type { CrewAward } from './names'
import { seatNamesOf } from './onlineRun'
import { isCoop, playersOf } from './party'
import type { PlayerSlot } from './worldSchema'

// The crew on a co-op end card (MULTIPLAYER.md, "The crew board"): each
// player's run read off their seat in the World, so every client shows the
// same numbers for everyone, and the awards those numbers win. Single
// player has no crew.

// THE CREW

export type CrewMember = Readonly<{
  slot: PlayerSlot
  name: string
  kills: number
  revives: number
  downs: number
  earned: number
  spent: number
  shotsFired: number
  aim: number
}>

const PERCENT = 100

// NOTE: a pierced shot can land more than once, so aim tops out at 100.
const aimOf = (fired: number, hit: number): number =>
  fired > 0 ? Math.min(PERCENT, Math.round((PERCENT * hit) / fired)) : 0

export const crewOf = (model: Model): ReadonlyArray<CrewMember> => {
  if (!isCoop(model)) {
    return []
  }
  const names = seatNamesOf(model)
  return Array.map(playersOf(model), ({ slot, seat, wallet }) => ({
    slot,
    name: names.get(slot) ?? `P${slot + 1}`,
    kills: seat.kills,
    revives: seat.revives,
    downs: seat.downs,
    earned: wallet.earned,
    spent: Math.max(0, wallet.earned - wallet.balance),
    shotsFired: seat.shotsFired,
    aim: aimOf(seat.shotsFired, seat.shotsHit),
  }))
}

// AWARDS

// NOTE: the order a player's awards are shown in, the first their title.
export const CREW_AWARDS: ReadonlyArray<CrewAward> = [
  'Mvp',
  'Medic',
  'Sharpshooter',
  'BigSpender',
  'MostMunched',
]

// NOTE: aim counts only for a player who fired this many shots, so one
// lucky shot is not a Sharpshooter.
export const SHARPSHOOTER_MIN_SHOTS = 20

const SCORES: Readonly<
  Record<CrewAward, (member: CrewMember) => Option.Option<number>>
> = {
  Mvp: member => Option.some(member.kills),
  Medic: member => Option.some(member.revives),
  Sharpshooter: member =>
    member.shotsFired >= SHARPSHOOTER_MIN_SHOTS
      ? Option.some(member.aim)
      : Option.none(),
  BigSpender: member => Option.some(member.spent),
  MostMunched: member => Option.some(member.downs),
}

type Scored = Readonly<{ slot: PlayerSlot; score: number }>

const byScoreThenSeat: Order.Order<Scored> = Order.combine(
  Order.flip(Order.mapInput(Order.Number, (scored: Scored) => scored.score)),
  Order.mapInput(Order.Number, (scored: Scored) => scored.slot),
)

// NOTE: an award goes to the highest score above 0, and a tie to the lower
// seat, so every player sees the same winner.
const winnerOf = (
  crew: ReadonlyArray<CrewMember>,
  award: CrewAward,
): Option.Option<PlayerSlot> =>
  pipe(
    crew,
    Array.filterMap(member =>
      Result.fromOption(
        Option.map(SCORES[award](member), (score): Scored => ({
          slot: member.slot,
          score,
        })),
        () => undefined,
      ),
    ),
    Array.sort(byScoreThenSeat),
    Array.head,
    Option.filter(scored => scored.score > 0),
    Option.map(scored => scored.slot),
  )

// NOTE: the most kills wears the crown.
export const mvpOf = (
  crew: ReadonlyArray<CrewMember>,
): Option.Option<PlayerSlot> => winnerOf(crew, 'Mvp')

// NOTE: every award a player won, in CREW_AWARDS order. A crew of one wins
// nothing: there is nobody to beat.
export const awardsOf = (
  crew: ReadonlyArray<CrewMember>,
  slot: PlayerSlot,
): ReadonlyArray<CrewAward> =>
  crew.length > 1
    ? Array.filter(CREW_AWARDS, award =>
        Option.exists(winnerOf(crew, award), winner => winner === slot),
      )
    : []

export const hasAwards = (crew: ReadonlyArray<CrewMember>): boolean =>
  Array.some(crew, member =>
    Array.isReadonlyArrayNonEmpty(awardsOf(crew, member.slot)),
  )
