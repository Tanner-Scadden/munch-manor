import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

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

// TABLE

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
// breakMs is how long the break between waves counts down, READY or the
// crew's READY starting the wave sooner. Every difficulty has one since the
// shop went (owner, 2026-11-10, reversing 2026-11-01's "no wave timers on
// easy/medium"): 30 s on Dare and Double Dare, 20 s on the two above. The
// open break before wave 2 still waits for READY (src/world/waves/waves.ts).
// Dare's own clock is the lobby's pick instead (owner, 2026-11-12: "allow
// the lobby owner to set the wave timer they want, and it can default to
// infinite"): the World's easyBreakSeconds, EASY_BREAK_CHOICES below, so
// Dare's breakMs is only what the tools read.
// tempo and lullScale are the wave's rhythm (owner, 2026-11-10, the pacing
// report's pick 8): tempo scales when each spawn and hold of a wave comes,
// so below 1 the peaks come sooner and closer together, and lullScale
// stretches the rest after each hold. The same count comes on every level.
// Double Dare keeps the rhythm as planned; Dare gets longer lulls, and the
// two above it peaks more often. runnerSpeedScale slows the Runners alone,
// on top of speedScale (owner, 2026-11-11: "They are tough"): Dare and
// Double Dare ease them, the two above keep them as they were. Uncle
// Chunk's party crashers keep the plain speedScale.
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
    const { healthScale, speedScale, runnerSpeedScale } =
      DIFFICULTIES[difficulty]
    return Array.map(spawns, spawn =>
      modifyFields(spawn, {
        speedScale: scale =>
          scale * speedScale * (spawn.kind === 'Runner' ? runnerSpeedScale : 1),
        hpScale: scale => scale * healthScale,
      }),
    )
  },
)

// NOTE: the difficulty's rhythm on a rolled wave (see DIFFICULTIES above):
// every spawn and hold comes at tempo times its planned time, and each
// hold's rest lasts lullScale times as long. Applied once as the break rolls
// the wave, so the preview and the wire carry the paced times.
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
          modifyFields(spawn, { atMs: atMs => Math.round(atMs * tempo) }),
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
          modifyFields(hold, {
            atMs: atMs => Math.round(atMs * tempo),
            relaxMs: relaxMs => Math.round(relaxMs * lullScale),
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
    return spreadSpawns({
      spawns,
      countScale,
      healthScale: scaleAt(COOP_RULES.healthScale, players),
    })
  },
)

// NOTE: each spawn copied so the wave holds countScale times as many, each
// copy a little after the one it copies, every one tougher by healthScale.
// The crowd above and the hungrier house (src/world/dare/finale.ts) share it.
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

export const reloadsWhenIdle = (difficulty: Difficulty): boolean =>
  DIFFICULTIES[difficulty].reloadsWhenIdle

export const breakMsOf = (difficulty: Difficulty): number =>
  DIFFICULTIES[difficulty].breakMs

// NOTE: Dare's break clocks the lobby offers, in seconds: none (the break
// waits for READY), then a relaxed minute, then the clocks the difficulties
// above use. The first is the default.
export const EASY_BREAK_CHOICES: Array.NonEmptyReadonlyArray<number> = [
  0, 60, 30, 20,
]

// NOTE: how long a World's next break counts down, or none when it waits
// for READY: on Dare the lobby's pick, above it the difficulty's breakMs.
// The dare ladder's mark 7 shortens it (src/world/run/dareLadder.ts).
export const breakClockMsOf = (world: World): Option.Option<number> =>
  markedBreakClock(
    world.dareMark,
    world.difficulty.chosen === 'Easy'
      ? world.easyBreakSeconds > 0
        ? Option.some(world.easyBreakSeconds * 1000)
        : Option.none()
      : Option.some(breakMsOf(world.difficulty.chosen)),
  )

// NOTE: the pick after this one, round again, for a key that steps it.
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
    !Phase.isAnyOf(['Escaped'])(before.phase) &&
    Phase.isAnyOf(['Escaped'])(after.phase),
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
