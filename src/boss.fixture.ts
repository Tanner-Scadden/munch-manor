// The boss tests' shared setup: the final wave's boss at a spot, the wave
// he fights in, and his events. src/boss.story.test.ts and
// src/bossAttacks.story.test.ts start from it.

import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { PARLOUR } from './arena'
import { freshFight } from './boss'
import {
  Boss,
  type BossMove,
  type GameEvent,
  Invulnerability,
  type Model,
  Phase,
  type PlannedSpawn,
  type Zombie,
} from './model'
import { newPlayerReady } from './model.fixture'
import { zombieOf } from './testing'
import { FINAL_WAVE, WAVE_PLANS } from './wavePlans'
import { ZOMBIE_KINDS, scaledHp } from './zombies'

export const CENTER_X = PARLOUR.width / 2
export const CENTER_Y = PARLOUR.height / 2
export const BOSS_ID = 777
export const WAVE_8_HP_SCALE = WAVE_PLANS[FINAL_WAVE - 1]?.hpScale ?? 1
export const BOSS_HP = scaledHp(ZOMBIE_KINDS.Boss.hp, WAVE_8_HP_SCALE)

export const spawnAt = (atMs: number, pack: number): PlannedSpawn => ({
  atMs,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack,
  formation: 'Squad',
})

export const inWave = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  boss: Boss,
  zombies: ReadonlyArray<Zombie> = [],
): Model =>
  modifyFields(newPlayerReady, {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }),
    boss: () => boss,
    zombies: () => zombies,
  })

export const bossAt = (x: number, y: number, hp = BOSS_HP): Zombie =>
  modifyFields(zombieOf('Boss', BOSS_ID, x, y, { hp }), {
    maxHp: () => BOSS_HP,
  })

export const fightingBoss = (move: BossMove): Boss => freshFight(BOSS_ID, move)

export const fightingWith = (
  move: BossMove,
  change: Partial<Omit<typeof Boss.Fighting.Type, '_tag' | 'id' | 'move'>>,
): Boss =>
  Boss.Fighting({
    ...Option.getOrThrow(
      Option.liftPredicate(fightingBoss(move), Boss.guards.Fighting),
    ),
    ...change,
  })

export const sturdy = (start: Model): Model =>
  modifyFields(start, {
    player: player =>
      modifyFields(player, {
        hp: () => 1e6,
        invulnerability: () =>
          Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
      }),
  })

export const eventsTagged = (
  events: ReadonlyArray<GameEvent>,
  tag: GameEvent['_tag'],
): ReadonlyArray<GameEvent> => Array.filter(events, event => event._tag === tag)
