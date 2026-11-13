import { Array, Function, Number, Option, Schema, String, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { maybeCrewBotAt } from '../../domain/bots'
import { seatNamesOf } from '../../domain/onlineRun'
import { isEndScreen } from '../../domain/run'
import { playedDifficultyOf } from '../../platform/analyticsRun'
import type { DayStamp } from '../../shared/dayStamp'
import { Difficulty } from '../../shared/playerData'
import {
  BIG_KEY,
  type CrewMate,
  type ProofEnding,
  type ProofEntry,
  type ProofStamp,
  type SavedProof,
  shelve,
} from '../../shared/proofData'
import { DareKind, DareThingState, Finale } from '../../world/dare/dareSchema'
import { focusOf, playersOf } from '../../world/party/party'
import { Phase } from '../../world/schema/worldSchema'

// The Proof Shelf's rules (docs/PROGRESSION_PLAN.md, pillar B): your
// friends' treehouse shelf, a slot per dare thing per difficulty and a hook
// for Uncle Chunk's big key on each, each slot keeping the first run that
// filled it (src/shared/proofData.ts). A run puts what it found on the
// shelf when it ends, as it pays out: munched, escaped, or out the back
// door. Each player's own client stamps its own shelf with the crew as it
// saw them, so nothing rides the wire.

// THE SLOTS

export const ShelfThing = Schema.Literals([...DareKind.literals, BIG_KEY])
export type ShelfThing = typeof ShelfThing.Type

export const ShelfSpot = Schema.Struct({
  thing: ShelfThing,
  difficulty: Difficulty,
})
export type ShelfSpot = typeof ShelfSpot.Type

// NOTE: the shelf's rows, easiest at the top, and each row's slots, the
// house's things in the dare card's order and the big key's hook last.
export const SHELF_ROWS: Array.NonEmptyReadonlyArray<Difficulty> =
  Difficulty.literals

export const SHELF_THINGS: Array.NonEmptyReadonlyArray<ShelfThing> =
  ShelfThing.literals

export const isBigKey = (thing: ShelfThing): thing is typeof BIG_KEY =>
  thing === BIG_KEY

export const slotId = (spot: ShelfSpot): string =>
  `proof-slot-${String.toLowerCase(spot.thing)}-${String.toLowerCase(spot.difficulty)}`

export const FIRST_SPOT: ShelfSpot = {
  thing: SHELF_THINGS[0],
  difficulty: SHELF_ROWS[0],
}

export const SLOT_COUNT = SHELF_ROWS.length * SHELF_THINGS.length

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

// NOTE: the slots this build knows that are filled (a thing a later build
// added stays on the shelf, unshown).
export const filledCount = (proof: SavedProof): number =>
  Array.filter(proof, entry =>
    Array.some(
      SHELF_ROWS,
      difficulty =>
        difficulty === entry.difficulty &&
        Array.some(SHELF_THINGS, thing => thing === entry.thing),
    ),
  ).length

// MOVING BETWEEN SLOTS

// NOTE: the arrow keys walk the shelf: left and right along a row, up and
// down between rows, wrapping at the ends.
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

export const maybeSteppedSpot: {
  (code: string): (spot: ShelfSpot) => Option.Option<ShelfSpot>
  (spot: ShelfSpot, code: string): Option.Option<ShelfSpot>
} = Function.dual(
  2,
  (spot: ShelfSpot, code: string): Option.Option<ShelfSpot> =>
    Option.map(Option.fromNullishOr(ARROW_STEPS[code]), ([columns, rows]) => ({
      thing: stepped(SHELF_THINGS, spot.thing, columns),
      difficulty: stepped(SHELF_ROWS, spot.difficulty, rows),
    })),
)

// DAYS

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

// NOTE: a stamp's day as the shelf prints it: NOV 13.
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

// NOTE: the weekday the month's first day falls on, Sunday 0, worked out
// from the date alone (Sakamoto's method), so no clock is read.
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

// NOTE: a day of a stamp's month, as a stamp.
export const dayOfMonth: {
  (day: number): (stamp: DayStamp) => DayStamp
  (stamp: DayStamp, day: number): DayStamp
} = Function.dual(2, (stamp: DayStamp, day: number): DayStamp => {
  const parts = dayPartsOf(stamp)
  return `${parts.year}-${twoDigits(parts.month)}-${twoDigits(day)}`
})

// NOTE: the month the calendar shows: today's, or the last stamped day's
// before today is known.
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

// NEW PIPS

// NOTE: a slot filled and a mission day stamped are each an unlock id in
// the synced set of what was seen (src/domain/unlocks.ts), so the PROOF
// card's NEW pip clears on every device once the shelf has been opened.
const entryUnlockId = (entry: ProofEntry): string =>
  `proof:${entry.thing}:${entry.difficulty}`

export const spotUnlockId = (spot: ShelfSpot): string =>
  `proof:${spot.thing}:${spot.difficulty}`

const dayUnlockId = (day: DayStamp): string => `proof:day:${day}`

const isProofId = (id: string): boolean => String.startsWith('proof:')(id)

const shelfIdsOf = (model: Model): ReadonlyArray<string> => [
  ...Array.map(model.proof, entryUnlockId),
  ...Array.map(model.missions.stampedDays, dayUnlockId),
]

const unseenProofOf = (model: Model): ReadonlyArray<string> =>
  Array.filter(shelfIdsOf(model), id => !Array.contains(model.seenUnlocks, id))

export const hasNewProof = (model: Model): boolean =>
  Array.isReadonlyArrayNonEmpty(unseenProofOf(model))

// NOTE: the shelf opened: everything on it is seen, and what was not wears
// NEW while it stays open.
export const markProofSeen = (model: Model): Model => {
  const unseen = unseenProofOf(model)
  return modifyFields(model, {
    freshUnlocks: fresh => [
      ...Array.filter(fresh, id => !isProofId(id)),
      ...unseen,
    ],
    seenUnlocks: seen => Array.union(seen, unseen),
  })
}

// SHELVING A RUN

// NOTE: how a run that just ended ended, off the phase it ends on. A run
// left from the pause MENU is no ending, so it shelves nothing.
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

// NOTE: the crew as this player saw them: everyone in the run but their
// own seat, named as the crew board names them, a bot marked a bot.
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

// NOTE: Uncle Chunk felled: his key in flight or the door open, or the
// crew already out through it.
const isChunkFelled = (run: Model): boolean =>
  Finale.isAnyOf(['KeyFlying', 'Open'])(run.dare.finale) ||
  Phase.isAnyOf(['Escaped'])(run.phase)

const shelfThingsOf = (run: Model): ReadonlyArray<ShelfThing> => [
  ...Array.flatMap(run.dareThings, thing =>
    DareThingState.isAnyOf(['Found'])(thing.state) ? [thing.kind] : [],
  ),
  ...(isChunkFelled(run) ? [BIG_KEY] : []),
]

// NOTE: on the frame a run reaches its end screen, everything it found
// goes on the shelf at its difficulty, stamped. A slot already filled
// keeps its first stamp.
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
        : modifyFields(after, { proof: () => proof })
    },
  })
})
