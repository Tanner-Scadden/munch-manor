import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { TOP_MARK } from '../../shared/dareMarkData'
import type { PlannedSpawn } from '../schema/worldSchema'
import { type Modifier, type Modifiers, bonusPercentOf } from './modifiers'

// The dare ladder (docs/PROGRESSION_PLAN.md, pillar E; GAME_DESIGN.md, "The
// dare ladder"): marks past the four difficulties, as Hades' heat. An
// escape on a difficulty opens its mark 1, and an escape at mark N opens
// N + 1 on it. Each mark keeps every rule of the marks below it and adds
// one: marks 1 to 4 turn on Big Crowd, Broke, Glass, and Friendly Fire (which
// bites, and pays, only with a crew, as it always did), and marks 5 to 8 add
// house rules of their own: Hotfoots faster, dearer padlocks, a shorter
// break clock, and Uncle Chunk tougher (owner, 2026-11-12: Chunk never
// changes below mark 5). The mark is a World field, so the co-op room plays
// it; this module is the pure leaf every rule reads.

// THE LADDER

// NOTE: the ladder's top, kept with the save's Schema.
export const MAX_MARK = TOP_MARK

export const MARKS: Array.NonEmptyReadonlyArray<number> = [
  1, 2, 3, 4, 5, 6, 7, 8,
]

// NOTE: the house rules of marks 5 and up, each turned on by its mark.
export const HouseRule = [
  'FastHotfoots',
  'DearPadlocks',
  'ShortBreaks',
  'ToughChunk',
] as const
export type HouseRule = (typeof HouseRule)[number]

const RULE_MARK: Readonly<Record<HouseRule, number>> = {
  FastHotfoots: 5,
  DearPadlocks: 6,
  ShortBreaks: 7,
  ToughChunk: 8,
}

// NOTE: the modifier each of marks 1 to 4 turns on.
const MODIFIER_MARK: Readonly<Record<Modifier, number>> = {
  BigCrowd: 1,
  Broke: 2,
  Glass: 3,
  FriendlyFire: 4,
}

// NOTE: a mark picked or saved, kept within the ladder.
export const clampMark = (mark: number): number =>
  Math.max(0, Math.min(MAX_MARK, Math.floor(mark)))

const isRuleOn: {
  (rule: HouseRule): (mark: number) => boolean
  (mark: number, rule: HouseRule): boolean
} = Function.dual(
  2,
  (mark: number, rule: HouseRule): boolean => mark >= RULE_MARK[rule],
)

// NOTE: whether a mark turns this modifier on, so the lobby shows its tile
// on and locked.
export const isCoveredByMark: {
  (modifier: Modifier): (mark: number) => boolean
  (mark: number, modifier: Modifier): boolean
} = Function.dual(
  2,
  (mark: number, modifier: Modifier): boolean =>
    mark >= MODIFIER_MARK[modifier],
)

// NOTE: the modifiers picked, with the ones the mark turns on.
export const withMarkModifiers: {
  (mark: number): (modifiers: Modifiers) => Modifiers
  (modifiers: Modifiers, mark: number): Modifiers
} = Function.dual(2, (modifiers: Modifiers, mark: number): Modifiers =>
  mark <= 0
    ? modifiers
    : {
        bigCrowd: modifiers.bigCrowd || isCoveredByMark(mark, 'BigCrowd'),
        broke: modifiers.broke || isCoveredByMark(mark, 'Broke'),
        glass: modifiers.glass || isCoveredByMark(mark, 'Glass'),
        friendlyFire:
          modifiers.friendlyFire || isCoveredByMark(mark, 'FriendlyFire'),
      },
)

// NOTE: the modifiers that are on in a run: its own picks and its mark's.
// Every World rule that reads a modifier reads it through here.
export const activeModifiersOf = (
  world: Readonly<{ modifiers: Modifiers; dareMark: number }>,
): Modifiers => withMarkModifiers(world.modifiers, world.dareMark)

// THE BONUS

// NOTE: marks 1 to 4 pay through their modifiers' own bonuses
// (src/world/run/modifiers.ts); each house rule adds this much more to the
// run's rank points and Bones, in percent, so the climb keeps paying.
const HOUSE_RULE_BONUS_PERCENT = 25

export const markBonusPercentOf = (mark: number): number =>
  Math.max(0, clampMark(mark) - 4) * HOUSE_RULE_BONUS_PERCENT

// NOTE: the whole bonus of a run's modifiers (as they bite) and its mark.
export const runBonusPercentOf: {
  (mark: number): (modifiers: Modifiers) => number
  (modifiers: Modifiers, mark: number): number
} = Function.dual(
  2,
  (modifiers: Modifiers, mark: number): number =>
    bonusPercentOf(modifiers) + markBonusPercentOf(mark),
)

// THE HOUSE RULES

// NOTE: mark 5: Hotfoots (the Runner kind) run this much faster, on top of
// the difficulty's own scales.
const HOTFOOT_SPEED_SCALE = 1.15

// NOTE: mark 6: every padlock asks this many times its keys, rounded.
const PADLOCK_PRICE_SCALE = 1.25

// NOTE: mark 7: every break's clock runs this share of its time, never
// below the floor; a break with no clock (Dare's ∞ pick) gets one of
// NO_CLOCK_MS times the share, so the mark bites on Dare too.
const BREAK_CLOCK_SCALE = 0.75
const BREAK_CLOCK_FLOOR_MS = 10_000
const NO_CLOCK_MS = 60_000

// NOTE: mark 8: Uncle Chunk's health, in the finale and Endless alike.
const CHUNK_HEALTH_SCALE = 1.25

export const markSpawns: {
  (
    spawns: ReadonlyArray<PlannedSpawn>,
  ): (mark: number) => ReadonlyArray<PlannedSpawn>
  (
    mark: number,
    spawns: ReadonlyArray<PlannedSpawn>,
  ): ReadonlyArray<PlannedSpawn>
} = Function.dual(
  2,
  (
    mark: number,
    spawns: ReadonlyArray<PlannedSpawn>,
  ): ReadonlyArray<PlannedSpawn> =>
    isRuleOn(mark, 'FastHotfoots')
      ? Array.map(spawns, spawn =>
          spawn.kind === 'Runner'
            ? modifyFields(spawn, {
                speedScale: scale => scale * HOTFOOT_SPEED_SCALE,
              })
            : spawn,
        )
      : spawns,
)

export const markedPadlockKeys: {
  (keys: number): (mark: number) => number
  (mark: number, keys: number): number
} = Function.dual(2, (mark: number, keys: number): number =>
  isRuleOn(mark, 'DearPadlocks')
    ? Math.round(keys * PADLOCK_PRICE_SCALE)
    : keys,
)

export const markedBreakClock: {
  (maybeMs: Option.Option<number>): (mark: number) => Option.Option<number>
  (mark: number, maybeMs: Option.Option<number>): Option.Option<number>
} = Function.dual(
  2,
  (mark: number, maybeMs: Option.Option<number>): Option.Option<number> =>
    isRuleOn(mark, 'ShortBreaks')
      ? Option.some(
          Math.max(
            BREAK_CLOCK_FLOOR_MS,
            Math.round(
              Option.getOrElse(maybeMs, () => NO_CLOCK_MS) * BREAK_CLOCK_SCALE,
            ),
          ),
        )
      : maybeMs,
)

export const chunkHealthScaleOf = (mark: number): number =>
  isRuleOn(mark, 'ToughChunk') ? CHUNK_HEALTH_SCALE : 1
