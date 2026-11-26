import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { PREPARATION_MS } from '../../shared/constants'
import { isObjectSecond } from '../../shared/dualArgs'
import { COOP_RULES } from '../party/party'
import { type World, modifyWorldFields } from '../schema/world'
import {
  type Difficulty,
  type DifficultySetting,
  type Hold,
  Phase,
  type PlannedSpawn,
} from '../schema/worldSchema'
import { markedBreakClock } from './dareLadder'
import { BIG_CROWD_SCALE, type Modifiers, noModifiers } from './modifiers'

type DifficultyStats = Readonly<{
  name: string
  blurb: string
  healthScale: number
  bossHealthScale: number
  bossAttackPace: number
  speedScale: number
  runnerSpeedScale: number
  biteScale: number
  biteGraceScale: number
  reloadsWhenIdle: boolean
  breakMs: number
  tempo: number
  lullScale: number
}>

export const DIFFICULTIES: Readonly<Record<Difficulty, DifficultyStats>> = {
  Easy: {
    name: 'Dare',
    blurb: 'Just here for the vibes',
    healthScale: 0.6,
    bossHealthScale: 1,
    bossAttackPace: 1,
    speedScale: 0.8,
    runnerSpeedScale: 0.6,
    biteScale: 0.5,
    biteGraceScale: 2,
    reloadsWhenIdle: true,
    breakMs: 30_000,
    tempo: 1,
    lullScale: 1.5,
  },
  Normal: {
    name: 'Double Dare',
    blurb: "The way it's meant to be played",
    healthScale: 0.68,
    bossHealthScale: 1,
    bossAttackPace: 1,
    speedScale: 0.84,
    runnerSpeedScale: 0.65,
    biteScale: 1,
    biteGraceScale: 1.5,
    reloadsWhenIdle: true,
    breakMs: 30_000,
    tempo: 1,
    lullScale: 1,
  },
  Hard: {
    name: 'Triple Dare',
    blurb: 'They bite back',
    healthScale: 1.08,
    bossHealthScale: 2.2,
    bossAttackPace: 0.8,
    speedScale: 1.02,
    runnerSpeedScale: 1,
    biteScale: 1,
    biteGraceScale: 1,
    reloadsWhenIdle: false,
    breakMs: PREPARATION_MS,
    tempo: 0.88,
    lullScale: 1,
  },
  Nightmare: {
    name: 'Triple Dog Dare',
    blurb: 'No backing out. Bring snacks',
    healthScale: 1.12,
    bossHealthScale: 3.2,
    bossAttackPace: 0.65,
    speedScale: 1.02,
    runnerSpeedScale: 1,
    biteScale: 1.25,
    biteGraceScale: 1,
    reloadsWhenIdle: false,
    breakMs: PREPARATION_MS,
    tempo: 0.8,
    lullScale: 1,
  },
}

export const DIFFICULTY_ORDER: Array.NonEmptyReadonlyArray<Difficulty> = [
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
]

export const NIGHTMARE_LOCK_NOTE = 'Escape on Triple Dare to unlock'

export const isLocked: {
  (difficulty: Difficulty): (setting: DifficultySetting) => boolean
  (setting: DifficultySetting, difficulty: Difficulty): boolean
} = Function.dual(
  2,
  (setting: DifficultySetting, difficulty: Difficulty): boolean =>
    difficulty === 'Nightmare' && setting.nightmare === 'Locked',
)

export const toughenSpawns: {
  (
    spawns: ReadonlyArray<PlannedSpawn>,
  ): (difficulty: Difficulty) => ReadonlyArray<PlannedSpawn>
  (
    difficulty: Difficulty,
    spawns: ReadonlyArray<PlannedSpawn>,
  ): ReadonlyArray<PlannedSpawn>
} = Function.dual(
  2,
  (
    difficulty: Difficulty,
    spawns: ReadonlyArray<PlannedSpawn>,
  ): ReadonlyArray<PlannedSpawn> => {
    const { healthScale, speedScale, runnerSpeedScale } =
      DIFFICULTIES[difficulty]
    return Array.map(spawns, spawn =>
      UiStruct.evolve(spawn, {
        speedScale: scale =>
          scale * speedScale * (spawn.kind === 'Runner' ? runnerSpeedScale : 1),
        hpScale: scale => scale * healthScale,
      }),
    )
  },
)

export const paceSpawns: {
  (
    spawns: ReadonlyArray<PlannedSpawn>,
  ): (difficulty: Difficulty) => ReadonlyArray<PlannedSpawn>
  (
    difficulty: Difficulty,
    spawns: ReadonlyArray<PlannedSpawn>,
  ): ReadonlyArray<PlannedSpawn>
} = Function.dual(
  2,
  (
    difficulty: Difficulty,
    spawns: ReadonlyArray<PlannedSpawn>,
  ): ReadonlyArray<PlannedSpawn> => {
    const { tempo } = DIFFICULTIES[difficulty]
    return tempo === 1
      ? spawns
      : Array.map(spawns, spawn =>
          UiStruct.evolve(spawn, { atMs: atMs => Math.round(atMs * tempo) }),
        )
  },
)

export const paceHolds: {
  (holds: ReadonlyArray<Hold>): (difficulty: Difficulty) => ReadonlyArray<Hold>
  (difficulty: Difficulty, holds: ReadonlyArray<Hold>): ReadonlyArray<Hold>
} = Function.dual(
  2,
  (difficulty: Difficulty, holds: ReadonlyArray<Hold>): ReadonlyArray<Hold> => {
    const { tempo, lullScale } = DIFFICULTIES[difficulty]
    return tempo === 1 && lullScale === 1
      ? holds
      : Array.map(holds, hold =>
          UiStruct.evolve(hold, {
            atMs: atMs => Math.round(atMs * tempo),
            relaxMs: relaxMs => Math.round(relaxMs * lullScale),
          }),
        )
  },
)

const CROWD_GAP_MS = 450
const CROWD_OFFSET_PX = 5

const scaleAt = (scales: ReadonlyArray<number>, players: number): number =>
  Option.getOrElse(
    Option.orElse(Array.get(scales, players - 1), () => Array.last(scales)),
    () => 1,
  )

export const crowdSpawns: {
  (
    spawns: ReadonlyArray<PlannedSpawn>,
    modifiers?: Modifiers,
  ): (players: number) => ReadonlyArray<PlannedSpawn>
  (
    players: number,
    spawns: ReadonlyArray<PlannedSpawn>,
    modifiers?: Modifiers,
  ): ReadonlyArray<PlannedSpawn>
} = Function.dual(
  (args: IArguments): boolean => typeof args[0] === 'number',
  (
    players: number,
    spawns: ReadonlyArray<PlannedSpawn>,
    modifiers: Modifiers = noModifiers,
  ): ReadonlyArray<PlannedSpawn> => {
    if (players <= 1 && !modifiers.bigCrowd) {
      return spawns
    }
    const countScale =
      scaleAt(COOP_RULES.waveCountScale, players) *
      (modifiers.bigCrowd ? BIG_CROWD_SCALE : 1)
    return spreadSpawns({
      spawns,
      countScale,
      healthScale: scaleAt(COOP_RULES.healthScale, players),
    })
  },
)

export const spreadSpawns = ({
  spawns,
  countScale,
  healthScale,
}: Readonly<{
  spawns: ReadonlyArray<PlannedSpawn>
  countScale: number
  healthScale: number
}>): ReadonlyArray<PlannedSpawn> =>
  Array.flatMap(spawns, (spawn, index) => {
    const copies =
      Math.floor((index + 1) * countScale) - Math.floor(index * countScale)
    const tougher = UiStruct.evolve(spawn, {
      hpScale: scale => scale * healthScale,
    })
    return Array.makeBy(copies, copy =>
      copy === 0
        ? tougher
        : UiStruct.evolve(tougher, {
            atMs: atMs => atMs + copy * CROWD_GAP_MS,
            offset: offset =>
              offset + (copy % 2 === 1 ? 1 : -1) * CROWD_OFFSET_PX,
          }),
    )
  })

export const reloadsWhenIdle = (difficulty: Difficulty): boolean =>
  DIFFICULTIES[difficulty].reloadsWhenIdle

export const breakMsOf = (difficulty: Difficulty): number =>
  DIFFICULTIES[difficulty].breakMs

export const EASY_BREAK_CHOICES: Array.NonEmptyReadonlyArray<number> = [
  0, 60, 30, 20,
]

export const breakClockMsOf = (world: World): Option.Option<number> =>
  markedBreakClock(
    world.dareMark,
    world.difficulty.chosen === 'Easy'
      ? world.easyBreakSeconds > 0
        ? Option.some(world.easyBreakSeconds * 1000)
        : Option.none()
      : Option.some(breakMsOf(world.difficulty.chosen)),
  )

export const nextEasyBreakOf = (seconds: number): number => {
  const index = Option.getOrElse(
    Array.findFirstIndex(EASY_BREAK_CHOICES, choice => choice === seconds),
    () => -1,
  )
  return Option.getOrElse(
    Array.get(EASY_BREAK_CHOICES, (index + 1) % EASY_BREAK_CHOICES.length),
    () => 0,
  )
}

export const difficultySpeedScale = (difficulty: Difficulty): number =>
  DIFFICULTIES[difficulty].speedScale

export const bossHealthScale = (difficulty: Difficulty): number =>
  DIFFICULTIES[difficulty].bossHealthScale

export const bossAttackPace = (difficulty: Difficulty): number =>
  DIFFICULTIES[difficulty].bossAttackPace

export const biteGraceScale = (difficulty: Difficulty): number =>
  DIFFICULTIES[difficulty].biteGraceScale

export const biteDamage: {
  (damage: number): (difficulty: Difficulty) => number
  (difficulty: Difficulty, damage: number): number
} = Function.dual(2, (difficulty: Difficulty, damage: number): number =>
  Math.max(1, Math.round(damage * DIFFICULTIES[difficulty].biteScale)),
)

export const chooseDifficulty: {
  <M extends World>(difficulty: Difficulty): (model: M) => M
  <M extends World>(model: M, difficulty: Difficulty): M
} = Function.dual(2, <M extends World>(model: M, difficulty: Difficulty): M =>
  isLocked(model.difficulty, difficulty)
    ? model
    : modifyWorldFields(model, {
        difficulty: setting =>
          UiStruct.evolve(setting, { chosen: () => difficulty }),
      }),
)

export const settleNightmare = <M extends World>(model: M): M =>
  model.difficulty.nightmare === 'JustUnlocked'
    ? modifyWorldFields(model, {
        difficulty: setting =>
          UiStruct.evolve(setting, { nightmare: () => 'Unlocked' }),
      })
    : model

export const hasJustWon: {
  (after: World): (before: World) => boolean
  (before: World, after: World): boolean
} = Function.dual(
  2,
  (before: World, after: World): boolean =>
    !Phase.isAnyOf(['Escaped'])(before.phase) &&
    Phase.isAnyOf(['Escaped'])(after.phase),
)

export const isNightmareUnlockedBy: {
  (after: World, played?: Difficulty): (before: World) => boolean
  (before: World, after: World, played?: Difficulty): boolean
} = Function.dual(
  isObjectSecond,
  (
    before: World,
    after: World,
    played: Difficulty = after.difficulty.chosen,
  ): boolean =>
    hasJustWon(before, after) &&
    played === 'Hard' &&
    after.difficulty.nightmare === 'Locked',
)

export const unlockNightmare = <M extends World>(model: M): M =>
  modifyWorldFields(model, {
    difficulty: setting =>
      UiStruct.evolve(setting, { nightmare: () => 'JustUnlocked' }),
  })
