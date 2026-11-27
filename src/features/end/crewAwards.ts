import { Array, Function, Option, Order, Result, pipe } from 'effect'

import type { Model } from '#app/model.ts'
import { seatNamesOf, seatRanksOf } from '#domain/onlineRun.ts'
import type { CrewAward } from '#world/names.ts'
import { isCoop, playersOf } from '#world/party/party.ts'
import type { PlayerSlot } from '#world/schema/worldSchema.ts'

export type CrewMember = Readonly<{
  slot: PlayerSlot
  name: string
  rank: number
  kills: number
  revives: number
  downs: number
  keysFound: number
  shotsFired: number
  aim: number
}>

const PERCENT = 100

const aimOf = (fired: number, hit: number): number =>
  fired > 0 ? Math.min(PERCENT, Math.round((PERCENT * hit) / fired)) : 0

export const crewOf = (model: Model): ReadonlyArray<CrewMember> => {
  if (!isCoop(model)) {
    return []
  }
  const names = seatNamesOf(model)
  const ranks = seatRanksOf(model)
  return Array.map(playersOf(model), ({ seat: { slot }, seat }) => ({
    slot,
    name: names.get(slot) ?? `P${slot + 1}`,
    rank: ranks.get(slot) ?? 1,
    kills: seat.kills,
    revives: seat.revives,
    downs: seat.downs,
    keysFound: seat.keysFound,
    shotsFired: seat.shotsFired,
    aim: aimOf(seat.shotsFired, seat.shotsHit),
  }))
}

export const CREW_AWARDS: ReadonlyArray<CrewAward> = [
  'Mvp',
  'Medic',
  'Sharpshooter',
  'KeyKeeper',
  'MostMunched',
]

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
  KeyKeeper: member => Option.some(member.keysFound),
  MostMunched: member => Option.some(member.downs),
}

type Scored = Readonly<{ slot: PlayerSlot; score: number }>

const byScoreThenSeat: Order.Order<Scored> = Order.combine(
  Order.flip(Order.mapInput(Order.Number, (scored: Scored) => scored.score)),
  Order.mapInput(Order.Number, (scored: Scored) => scored.slot),
)

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

export const mvpOf = (
  crew: ReadonlyArray<CrewMember>,
): Option.Option<PlayerSlot> => winnerOf(crew, 'Mvp')

export const awardsOf: {
  (
    slot: PlayerSlot,
  ): (crew: ReadonlyArray<CrewMember>) => ReadonlyArray<CrewAward>
  (crew: ReadonlyArray<CrewMember>, slot: PlayerSlot): ReadonlyArray<CrewAward>
} = Function.dual(
  2,
  (
    crew: ReadonlyArray<CrewMember>,
    slot: PlayerSlot,
  ): ReadonlyArray<CrewAward> =>
    crew.length > 1
      ? Array.filter(CREW_AWARDS, award =>
          Option.exists(winnerOf(crew, award), winner => winner === slot),
        )
      : [],
)

export const hasAwards = (crew: ReadonlyArray<CrewMember>): boolean =>
  Array.some(crew, member =>
    Array.isReadonlyArrayNonEmpty(awardsOf(crew, member.slot)),
  )
