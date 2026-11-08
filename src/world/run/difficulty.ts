import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { isObjectSecond } from '../../shared/dualArgs'
import { COOP_RULES } from '../party/party'
import { type World, modifyWorldFields } from '../schema/world'
import {
  type Difficulty,
  type DifficultySetting,
  Phase,
  type PlannedSpawn,
} from '../schema/worldSchema'
import { BIG_CROWD_SCALE, type Modifiers, noModifiers } from './modifiers'

// TABLE

type DifficultyStats = Readonly<{
  name: string
  blurb: string
  healthScale: number
  bossHealthScale: number
  bossAttackPace: number
  speedScale: number
  biteScale: number
  biteGraceScale: number
  reloadsWhenIdle: boolean
  hasBreakClock: boolean
}>

// NOTE: the scales multiply every zombie's base health and speed, the boss
// and his belched Groaners too, on top of the wave's own scales. A bite is
// whole hearts, so it rounds and never drops below one. Normal is 1: the
// Plank Pile's price, not Normal's scales, pays for how strong boarded doors
// are. Below Hard a gun also reloads by itself once the trigger rests
// (src/world/step/firing.ts); Hard and Nightmare leave it to R. biteGraceScale
// stretches the blink after a bite (1 s, 1.5 s on the last heart), so a
// crowd's bites come further apart below Hard. bossHealthScale is Uncle
// Chunk's own, on top of healthScale (src/world/zombies/boss.ts): a finale on Hard and
// Nightmare, where a late loadout melted him, without a tougher crowd.
// hasBreakClock is whether the break between waves counts down (owner,
// 2026-11-01: "don't want wave timers on easy/medium. Too much."): below Hard
// a break waits for READY (BreakClock.Waiting, src/world/waves/waves.ts).
export const DIFFICULTIES: Readonly<Record<Difficulty, DifficultyStats>> = {
  Easy: {
    name: 'Easy',
    blurb: 'Just here for the vibes',
    healthScale: 0.6,
    bossHealthScale: 1,
    bossAttackPace: 1,
    speedScale: 0.8,
    biteScale: 0.5,
    biteGraceScale: 2,
    reloadsWhenIdle: true,
    hasBreakClock: false,
  },
  Normal: {
    name: 'Normal',
    blurb: "The way it's meant to be played",
    healthScale: 0.75,
    bossHealthScale: 1,
    bossAttackPace: 1,
    speedScale: 0.84,
    biteScale: 1,
    biteGraceScale: 1.5,
    reloadsWhenIdle: true,
    hasBreakClock: false,
  },
  Hard: {
    name: 'Hard',
    blurb: 'They bite back',
    healthScale: 1.08,
    bossHealthScale: 2.2,
    bossAttackPace: 0.8,
    speedScale: 1.02,
    biteScale: 1,
    biteGraceScale: 1,
    reloadsWhenIdle: false,
    hasBreakClock: true,
  },
  Nightmare: {
    name: 'Nightmare',
    blurb: 'No mercy. Bring snacks',
    healthScale: 1.16,
    bossHealthScale: 3.2,
    bossAttackPace: 0.65,
    speedScale: 1.02,
    biteScale: 1.25,
    biteGraceScale: 1,
    reloadsWhenIdle: false,
    hasBreakClock: true,
  },
}

export const DIFFICULTY_ORDER: Array.NonEmptyReadonlyArray<Difficulty> = [
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
]

export const NIGHTMARE_LOCK_NOTE = 'Beat Hard to unlock'

export const isLocked: {
  (difficulty: Difficulty): (setting: DifficultySetting) => boolean
  (setting: DifficultySetting, difficulty: Difficulty): boolean
} = Function.dual(
  2,
  (setting: DifficultySetting, difficulty: Difficulty): boolean =>
    difficulty === 'Nightmare' && setting.nightmare === 'Locked',
)

// SCALES

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
    const { healthScale, speedScale } = DIFFICULTIES[difficulty]
    return Array.map(spawns, spawn =>
      modifyFields(spawn, {
        speedScale: scale => scale * speedScale,
        hpScale: scale => scale * healthScale,
      }),
    )
  },
)

// NOTE: co-op's crowd (decided 3): every planned zombie comes with copies
// spread evenly through the wave, so the count scales by the player count's
// waveCountScale, each a little after the one it copies, and every one is
// tougher by its healthScale. One player keeps the wave exactly as rolled.
const CROWD_GAP_MS = 450
const CROWD_OFFSET_PX = 5

const scaleAt = (scales: ReadonlyArray<number>, players: number): number =>
  Option.getOrElse(
    Option.orElse(Array.get(scales, players - 1), () => Array.last(scales)),
    () => 1,
  )

// NOTE: the Big Crowd modifier multiplies the count again, alone or in a
// crew, the same way: the extra copies are not tougher on their own.
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
  // NOTE: data-first starts with the player count; data-last with the spawns.
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
    const healthScale = scaleAt(COOP_RULES.healthScale, players)
    return Array.flatMap(spawns, (spawn, index) => {
      const copies =
        Math.floor((index + 1) * countScale) - Math.floor(index * countScale)
      const tougher = modifyFields(spawn, {
        hpScale: scale => scale * healthScale,
      })
      return Array.makeBy(copies, copy =>
        copy === 0
          ? tougher
          : modifyFields(tougher, {
              atMs: atMs => atMs + copy * CROWD_GAP_MS,
              offset: offset =>
                offset + (copy % 2 === 1 ? 1 : -1) * CROWD_OFFSET_PX,
            }),
      )
    })
  },
)

export const reloadsWhenIdle = (difficulty: Difficulty): boolean =>
  DIFFICULTIES[difficulty].reloadsWhenIdle

export const hasBreakClock = (difficulty: Difficulty): boolean =>
  DIFFICULTIES[difficulty].hasBreakClock

export const difficultySpeedScale = (difficulty: Difficulty): number =>
  DIFFICULTIES[difficulty].speedScale

export const bossHealthScale = (difficulty: Difficulty): number =>
  DIFFICULTIES[difficulty].bossHealthScale

// NOTE: the gap before his next attack and his belch timer are multiplied by
// this, so below 1 he attacks more often. Wind-ups and recoveries stay.
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

// CHOOSING

export const chooseDifficulty: {
  <M extends World>(difficulty: Difficulty): (model: M) => M
  <M extends World>(model: M, difficulty: Difficulty): M
} = Function.dual(2, <M extends World>(model: M, difficulty: Difficulty): M =>
  isLocked(model.difficulty, difficulty)
    ? model
    : modifyWorldFields(model, {
        difficulty: setting =>
          modifyFields(setting, { chosen: () => difficulty }),
      }),
)

export const settleNightmare = <M extends World>(model: M): M =>
  model.difficulty.nightmare === 'JustUnlocked'
    ? modifyWorldFields(model, {
        difficulty: setting =>
          modifyFields(setting, { nightmare: () => 'Unlocked' }),
      })
    : model

// UNLOCKING

export const hasJustWon: {
  (after: World): (before: World) => boolean
  (before: World, after: World): boolean
} = Function.dual(
  2,
  (before: World, after: World): boolean =>
    !Phase.isAnyOf(['Victory'])(before.phase) &&
    Phase.isAnyOf(['Victory'])(after.phase),
)

// NOTE: `played` is the run's difficulty: the player's own pick, or in an
// online co-op run the one the room's host picked.
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
      modifyFields(setting, { nightmare: () => 'JustUnlocked' }),
  })
