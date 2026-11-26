import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { TOP_MARK } from '#shared/dareMarkData.ts'
import type { PlannedSpawn } from '#world/schema/worldSchema.ts'

import { type Modifier, type Modifiers, bonusPercentOf } from './modifiers.ts'

export const MAX_MARK = TOP_MARK

export const MARKS: Array.NonEmptyReadonlyArray<number> = [
  1, 2, 3, 4, 5, 6, 7, 8,
]

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

const MODIFIER_MARK: Readonly<Record<Modifier, number>> = {
  BigCrowd: 1,
  Broke: 2,
  Glass: 3,
  FriendlyFire: 4,
}

export const clampMark = (mark: number): number =>
  Math.max(0, Math.min(MAX_MARK, Math.floor(mark)))

const isRuleOn: {
  (rule: HouseRule): (mark: number) => boolean
  (mark: number, rule: HouseRule): boolean
} = Function.dual(
  2,
  (mark: number, rule: HouseRule): boolean => mark >= RULE_MARK[rule],
)

export const isCoveredByMark: {
  (modifier: Modifier): (mark: number) => boolean
  (mark: number, modifier: Modifier): boolean
} = Function.dual(
  2,
  (mark: number, modifier: Modifier): boolean =>
    mark >= MODIFIER_MARK[modifier],
)

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

export const activeModifiersOf = (
  world: Readonly<{ modifiers: Modifiers; dareMark: number }>,
): Modifiers => withMarkModifiers(world.modifiers, world.dareMark)

const HOUSE_RULE_BONUS_PERCENT = 25

export const markBonusPercentOf = (mark: number): number =>
  Math.max(0, clampMark(mark) - 4) * HOUSE_RULE_BONUS_PERCENT

export const runBonusPercentOf: {
  (mark: number): (modifiers: Modifiers) => number
  (modifiers: Modifiers, mark: number): number
} = Function.dual(
  2,
  (modifiers: Modifiers, mark: number): number =>
    bonusPercentOf(modifiers) + markBonusPercentOf(mark),
)

const HOTFOOT_SPEED_SCALE = 1.15

const PADLOCK_PRICE_SCALE = 1.25

const BREAK_CLOCK_SCALE = 0.75
const BREAK_CLOCK_FLOOR_MS = 10_000
const NO_CLOCK_MS = 60_000

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
            ? UiStruct.evolve(spawn, {
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
