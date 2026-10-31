import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { COOP_RULES } from './party'
import { type World, modifyWorldFields } from './world'
import {
  type Difficulty,
  type DifficultySetting,
  Phase,
  type PlannedSpawn,
} from './worldSchema'

// TABLE

type DifficultyStats = Readonly<{
  name: string
  blurb: string
  healthScale: number
  speedScale: number
  biteScale: number
  reloadsWhenIdle: boolean
}>

// NOTE: the scales multiply every zombie's base health and speed, the boss
// and his belched Groaners too, on top of the wave's own scales. A bite is
// whole hearts, so it rounds and never drops below one. Normal is 1: the
// Plank Pile's price, not Normal's scales, pays for how strong boarded doors
// are. Below Hard a gun also reloads by itself once the trigger rests
// (src/firing.ts); Hard and Nightmare leave it to R.
export const DIFFICULTIES: Readonly<Record<Difficulty, DifficultyStats>> = {
  Easy: {
    name: 'Easy',
    blurb: 'Just here for the vibes',
    healthScale: 0.85,
    speedScale: 0.9,
    biteScale: 0.5,
    reloadsWhenIdle: true,
  },
  Normal: {
    name: 'Normal',
    blurb: "The way it's meant to be played",
    healthScale: 1,
    speedScale: 1,
    biteScale: 1,
    reloadsWhenIdle: true,
  },
  Hard: {
    name: 'Hard',
    blurb: 'They bite back',
    healthScale: 1.08,
    speedScale: 1.02,
    biteScale: 1,
    reloadsWhenIdle: false,
  },
  Nightmare: {
    name: 'Nightmare',
    blurb: 'No mercy. Bring snacks',
    healthScale: 1.16,
    speedScale: 1.02,
    biteScale: 1.25,
    reloadsWhenIdle: false,
  },
}

export const DIFFICULTY_ORDER: Array.NonEmptyReadonlyArray<Difficulty> = [
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
]

export const NIGHTMARE_LOCK_NOTE = 'Beat Hard to unlock'

export const isLocked = (
  setting: DifficultySetting,
  difficulty: Difficulty,
): boolean => difficulty === 'Nightmare' && setting.nightmare === 'Locked'

// SCALES

export const toughenSpawns = (
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
}

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

export const crowdSpawns = (
  players: number,
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<PlannedSpawn> => {
  if (players <= 1) {
    return spawns
  }
  const countScale = scaleAt(COOP_RULES.waveCountScale, players)
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
}

export const reloadsWhenIdle = (difficulty: Difficulty): boolean =>
  DIFFICULTIES[difficulty].reloadsWhenIdle

export const difficultySpeedScale = (difficulty: Difficulty): number =>
  DIFFICULTIES[difficulty].speedScale

export const biteDamage = (difficulty: Difficulty, damage: number): number =>
  Math.max(1, Math.round(damage * DIFFICULTIES[difficulty].biteScale))

// CHOOSING

export const chooseDifficulty = <M extends World>(
  model: M,
  difficulty: Difficulty,
): M =>
  isLocked(model.difficulty, difficulty)
    ? model
    : modifyWorldFields(model, {
        difficulty: setting =>
          modifyFields(setting, { chosen: () => difficulty }),
      })

export const settleNightmare = <M extends World>(model: M): M =>
  model.difficulty.nightmare === 'JustUnlocked'
    ? modifyWorldFields(model, {
        difficulty: setting =>
          modifyFields(setting, { nightmare: () => 'Unlocked' }),
      })
    : model

// UNLOCKING

export const hasJustWon = (before: World, after: World): boolean =>
  !Phase.isAnyOf(['Victory'])(before.phase) &&
  Phase.isAnyOf(['Victory'])(after.phase)

// NOTE: `played` is the run's difficulty: the player's own pick, or in an
// online co-op run the one the room's host picked.
export const isNightmareUnlockedBy = (
  before: World,
  after: World,
  played: Difficulty = after.difficulty.chosen,
): boolean =>
  hasJustWon(before, after) &&
  played === 'Hard' &&
  after.difficulty.nightmare === 'Locked'

export const unlockNightmare = <M extends World>(model: M): M =>
  modifyWorldFields(model, {
    difficulty: setting =>
      modifyFields(setting, { nightmare: () => 'JustUnlocked' }),
  })
