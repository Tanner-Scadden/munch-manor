import { Array, Function, Number, Option, Schema, String, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { maybeCrewBotAt } from '#domain/bots.ts'
import { seatNamesOf } from '#domain/onlineRun.ts'
import { isEndScreen } from '#domain/run.ts'
import { playedDifficultyOf } from '#platform/analytics/analyticsRun.ts'
import type { DayStamp } from '#shared/records/dayStamp.ts'
import { Difficulty } from '#shared/records/playerData.ts'
import {
  BIG_KEY,
  type CrewMate,
  type ProofEnding,
  type ProofEntry,
  type ProofStamp,
  type SavedProof,
  shelve,
} from '#shared/records/proofData.ts'
import {
  DareKind,
  DareThingState,
  Finale,
  HOUSE_THINGS,
} from '#world/dare/dareSchema.ts'
import { dareThingPool, thingsOpenedBy } from '#world/dare/milestones.ts'
import { focusOf, playersOf } from '#world/party/party.ts'
import { Phase } from '#world/schema/worldSchema.ts'

export const ShelfThing = Schema.Literals([...DareKind.literals, BIG_KEY])
export type ShelfThing = typeof ShelfThing.Type

export const ShelfSpot = Schema.Struct({
  thing: ShelfThing,
  difficulty: Difficulty,
})
export type ShelfSpot = typeof ShelfSpot.Type

export const SHELF_ROWS: Array.NonEmptyReadonlyArray<Difficulty> =
  Difficulty.literals

export const shelfThingsFor = (
  opened: ReadonlyArray<DareKind>,
): Array.NonEmptyReadonlyArray<ShelfThing> =>
  Array.append(dareThingPool(opened), BIG_KEY)

export const isBigKey = (thing: ShelfThing): thing is typeof BIG_KEY =>
  thing === BIG_KEY

export const slotId = (spot: ShelfSpot): string =>
  `proof-slot-${String.toLowerCase(spot.thing)}-${String.toLowerCase(spot.difficulty)}`

export const FIRST_SPOT: ShelfSpot = {
  thing: Array.headNonEmpty(HOUSE_THINGS),
  difficulty: SHELF_ROWS[0],
}

export const slotCountOf = (things: ReadonlyArray<ShelfThing>): number =>
  SHELF_ROWS.length * things.length

export const maybeStampAt: {
  (spot: ShelfSpot): (proof: SavedProof) => Option.Option<ProofStamp>
  (proof: SavedProof, spot: ShelfSpot): Option.Option<ProofStamp>
} = Function.dual(
  2,
  (proof: SavedProof, spot: ShelfSpot): Option.Option<ProofStamp> =>
    pipe(
      Array.findFirst(
        proof,
        entry =>
          entry.thing === spot.thing && entry.difficulty === spot.difficulty,
      ),
      Option.map(entry => entry.stamp),
    ),
)

export const filledCount: {
  (things: ReadonlyArray<ShelfThing>): (proof: SavedProof) => number
  (proof: SavedProof, things: ReadonlyArray<ShelfThing>): number
} = Function.dual(
  2,
  (proof: SavedProof, things: ReadonlyArray<ShelfThing>): number =>
    Array.filter(proof, entry =>
      Array.some(
        SHELF_ROWS,
        difficulty =>
          difficulty === entry.difficulty &&
          Array.some(things, thing => thing === entry.thing),
      ),
    ).length,
)

const ARROW_STEPS: Readonly<
  Record<string, readonly [columns: number, rows: number]>
> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

const wrapped = (index: number, count: number): number =>
  (index + count) % count

const stepped = <A>(
  list: Array.NonEmptyReadonlyArray<A>,
  from: A,
  step: number,
): A =>
  pipe(
    Array.findFirstIndex(list, item => item === from),
    Option.getOrElse(() => 0),
    index => Array.get(list, wrapped(index + step, list.length)),
    Option.getOrElse(() => from),
  )

export type Press = Readonly<{
  code: string
  things: Array.NonEmptyReadonlyArray<ShelfThing>
}>

export const maybeSteppedSpot: {
  (press: Press): (spot: ShelfSpot) => Option.Option<ShelfSpot>
  (spot: ShelfSpot, press: Press): Option.Option<ShelfSpot>
} = Function.dual(
  2,
  (spot: ShelfSpot, { code, things }: Press): Option.Option<ShelfSpot> =>
    Option.map(Option.fromNullishOr(ARROW_STEPS[code]), ([columns, rows]) => ({
      thing: stepped(things, spot.thing, columns),
      difficulty: stepped(SHELF_ROWS, spot.difficulty, rows),
    })),
)

const MONTHS: Array.NonEmptyReadonlyArray<string> = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
]

const monthName = (month: number): string =>
  Option.getOrElse(Array.get(MONTHS, month - 1), () => '')

type DayParts = Readonly<{ year: number; month: number; day: number }>

const partOf = (stamp: DayStamp, from: number, to: number): number =>
  Option.getOrElse(Number.parse(String.slice(from, to)(stamp)), () => 1)

const dayPartsOf = (stamp: DayStamp): DayParts => ({
  year: partOf(stamp, 0, 4),
  month: partOf(stamp, 5, 7),
  day: partOf(stamp, 8, 10),
})

export const dayLabel = (stamp: DayStamp): string => {
  const { month, day } = dayPartsOf(stamp)
  return `${monthName(month)} ${day}`
}

export const monthLabel = (stamp: DayStamp): string => {
  const { year, month } = dayPartsOf(stamp)
  return `${monthName(month)} ${year}`
}

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export const daysInMonth = (stamp: DayStamp): number => {
  const { year, month } = dayPartsOf(stamp)
  return month === 2 && isLeapYear(year)
    ? 29
    : Option.getOrElse(Array.get(MONTH_DAYS, month - 1), () => 30)
}

const WEEKDAY_OFFSETS = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]

export const firstWeekdayOf = (stamp: DayStamp): number => {
  const { year, month } = dayPartsOf(stamp)
  const shifted = month < 3 ? year - 1 : year
  return (
    (shifted +
      Math.floor(shifted / 4) -
      Math.floor(shifted / 100) +
      Math.floor(shifted / 400) +
      Option.getOrElse(Array.get(WEEKDAY_OFFSETS, month - 1), () => 0) +
      1) %
    7
  )
}

const twoDigits = (value: number): string =>
  value < 10 ? `0${value}` : `${value}`

export const dayOfMonth: {
  (day: number): (stamp: DayStamp) => DayStamp
  (stamp: DayStamp, day: number): DayStamp
} = Function.dual(2, (stamp: DayStamp, day: number): DayStamp => {
  const parts = dayPartsOf(stamp)
  return `${parts.year}-${twoDigits(parts.month)}-${twoDigits(day)}`
})

export const maybeCalendarDay: {
  (
    stampedDays: ReadonlyArray<DayStamp>,
  ): (maybeToday: Option.Option<DayStamp>) => Option.Option<DayStamp>
  (
    maybeToday: Option.Option<DayStamp>,
    stampedDays: ReadonlyArray<DayStamp>,
  ): Option.Option<DayStamp>
} = Function.dual(
  2,
  (
    maybeToday: Option.Option<DayStamp>,
    stampedDays: ReadonlyArray<DayStamp>,
  ): Option.Option<DayStamp> =>
    Option.orElse(maybeToday, () =>
      Array.last(Array.sort(stampedDays, String.Order)),
    ),
)

const entryUnlockId = (entry: ProofEntry): string =>
  `proof:${entry.thing}:${entry.difficulty}`

export const spotUnlockId = (spot: ShelfSpot): string =>
  `proof:${spot.thing}:${spot.difficulty}`

const dayUnlockId = (day: DayStamp): string => `proof:day:${day}`

const openedUnlockId = (kind: DareKind): string => `proof:open:${kind}`

const isProofId = (id: string): boolean => String.startsWith('proof:')(id)

const shelfIdsOf = (model: Model): ReadonlyArray<string> => [
  ...Array.map(model.proof, entryUnlockId),
  ...Array.map(model.missions.stampedDays, dayUnlockId),
  ...Array.map(thingsOpenedBy(model.journal.milestones), openedUnlockId),
]

const unseenProofOf = (model: Model): ReadonlyArray<string> =>
  Array.filter(shelfIdsOf(model), id => !Array.contains(model.seenUnlocks, id))

export const hasNewProof = (model: Model): boolean =>
  Array.isReadonlyArrayNonEmpty(unseenProofOf(model))

export const markProofSeen = (model: Model): Model => {
  const unseen = unseenProofOf(model)
  return UiStruct.evolve(model, {
    freshUnlocks: fresh => [
      ...Array.filter(fresh, id => !isProofId(id)),
      ...unseen,
    ],
    seenUnlocks: seen => Array.union(seen, unseen),
  })
}

const maybeEndingOf = (phase: Phase): Option.Option<ProofEnding> =>
  Phase.matchOrElse(
    phase,
    {
      GameOver: (): Option.Option<ProofEnding> => Option.some('Munched'),
      Escaped: (): Option.Option<ProofEnding> => Option.some('Escaped'),
      LeftEarly: (): Option.Option<ProofEnding> => Option.some('Chicken'),
    },
    () => Option.none(),
  )

const waveOf = (phase: Phase): number =>
  Phase.matchOrElse(
    phase,
    {
      GameOver: ({ wave }) => wave,
      Escaped: ({ wave }) => wave,
      LeftEarly: ({ wave }) => wave,
    },
    () => 0,
  )

const MAX_NAME = 32

const crewOf = (run: Model): ReadonlyArray<CrewMate> => {
  const names = seatNamesOf(run)
  const ownSlot = focusOf(run).seat.slot
  return pipe(
    playersOf(run),
    Array.filter(seat => seat.seat.slot !== ownSlot),
    Array.map(seat => ({
      name: String.slice(
        0,
        MAX_NAME,
      )(
        Option.getOrElse(
          Option.fromNullishOr(names.get(seat.seat.slot)),
          () => `P${seat.seat.slot + 1}`,
        ),
      ),
      isBot: Option.isSome(maybeCrewBotAt(run, seat.seat.slot)),
    })),
    Array.take(3),
  )
}

const isChunkFelled = (run: Model): boolean =>
  Finale.isAnyOf(['KeyFlying', 'Open'])(run.dare.finale) ||
  Phase.isAnyOf(['Escaped'])(run.phase)

const shelfThingsOf = (run: Model): ReadonlyArray<ShelfThing> => [
  ...Array.flatMap(run.dareThings, thing =>
    DareThingState.isAnyOf(['Found'])(thing.state) ? [thing.kind] : [],
  ),
  ...(isChunkFelled(run) ? [BIG_KEY] : []),
]

export const shelveRun: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model => {
  if (isEndScreen(before.phase) || !isEndScreen(after.phase)) {
    return after
  }
  return Option.match(maybeEndingOf(after.phase), {
    onNone: () => after,
    onSome: ending => {
      const things = shelfThingsOf(after)
      if (!Array.isReadonlyArrayNonEmpty(things)) {
        return after
      }
      const stamp: ProofStamp = {
        wave: waveOf(after.phase),
        hero: focusOf(after).player.calling,
        crew: crewOf(after),
        day: Option.getOrNull(after.maybeToday),
        ending,
      }
      const difficulty = playedDifficultyOf(after)
      const proof = Array.reduce(things, after.proof, (shelf, thing) =>
        shelve(shelf, { thing, difficulty, stamp }),
      )
      return proof === after.proof
        ? after
        : UiStruct.evolve(after, { proof: () => proof })
    },
  })
})
