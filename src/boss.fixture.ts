// The boss tests' shared setup: the final wave's boss at a spot, the wave
// he fights in, and his events. src/boss.story.test.ts and
// src/bossAttacks.story.test.ts start from it.

import { Array, Function, Option } from 'effect'
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
import { modifyFocus } from './party'
import { zombieOf } from './testing'
import { FINAL_WAVE, WAVE_PLANS } from './wavePlans'
import { ZOMBIE_KINDS, scaledHp } from './zombies'

export const CENTER_X = PARLOUR.width / 2
export const CENTER_Y = PARLOUR.height / 2
export const BOSS_ID = 777
export const WAVE_8_HP_SCALE = WAVE_PLANS[FINAL_WAVE - 1]?.hpScale ?? 1
export const BOSS_HP = scaledHp(ZOMBIE_KINDS.Boss.hp, WAVE_8_HP_SCALE)

export const spawnAt: {
  (pack: number): (atMs: number) => PlannedSpawn
  (atMs: number, pack: number): PlannedSpawn
} = Function.dual(2, (atMs: number, pack: number): PlannedSpawn => ({
  atMs,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack,
  formation: 'Squad',
}))

// NOTE: data first when the wave leads: a wave is a number, spawns are not.
export const inWave: {
  (
    spawns: ReadonlyArray<PlannedSpawn>,
    boss: Boss,
    zombies?: ReadonlyArray<Zombie>,
  ): (wave: number) => Model
  (
    wave: number,
    spawns: ReadonlyArray<PlannedSpawn>,
    boss: Boss,
    zombies?: ReadonlyArray<Zombie>,
  ): Model
} = Function.dual(
  (args: IArguments) => typeof args[0] === 'number',
  (
    wave: number,
    spawns: ReadonlyArray<PlannedSpawn>,
    boss: Boss,
    zombies: ReadonlyArray<Zombie> = [],
  ): Model =>
    modifyFields(newPlayerReady, {
      phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }),
      boss: () => boss,
      zombies: () => zombies,
    }),
)

// NOTE: the boss at full health, out of BOSS_HP.
export const bossAt: {
  (y: number): (x: number) => Zombie
  (x: number, y: number): Zombie
} = Function.dual(2, (x: number, y: number): Zombie =>
  modifyFields(zombieOf('Boss', BOSS_ID, x, y, { hp: BOSS_HP }), {
    maxHp: () => BOSS_HP,
  }),
)

// NOTE: the boss with `hp` left, out of BOSS_HP.
export const bossWithHpAt: {
  (x: number, y: number): (hp: number) => Zombie
  (hp: number, x: number, y: number): Zombie
} = Function.dual(3, (hp: number, x: number, y: number): Zombie =>
  modifyFields(bossAt(x, y), { hp: () => hp }),
)

export const fightingBoss = (move: BossMove): Boss => freshFight(BOSS_ID, move)

export const fightingWith: {
  (
    change: Partial<Omit<typeof Boss.Fighting.Type, '_tag' | 'id' | 'move'>>,
  ): (move: BossMove) => Boss
  (
    move: BossMove,
    change: Partial<Omit<typeof Boss.Fighting.Type, '_tag' | 'id' | 'move'>>,
  ): Boss
} = Function.dual(
  2,
  (
    move: BossMove,
    change: Partial<Omit<typeof Boss.Fighting.Type, '_tag' | 'id' | 'move'>>,
  ): Boss =>
    Boss.Fighting({
      ...Option.getOrThrow(
        Option.liftPredicate(fightingBoss(move), Boss.guards.Fighting),
      ),
      ...change,
    }),
)

export const sturdy = (start: Model): Model =>
  modifyFocus(start, {
    player: player =>
      modifyFields(player, {
        hp: () => 1e6,
        invulnerability: () =>
          Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
      }),
  })

export const eventsTagged: {
  (
    tag: GameEvent['_tag'],
  ): (events: ReadonlyArray<GameEvent>) => ReadonlyArray<GameEvent>
  (
    events: ReadonlyArray<GameEvent>,
    tag: GameEvent['_tag'],
  ): ReadonlyArray<GameEvent>
} = Function.dual(
  2,
  (
    events: ReadonlyArray<GameEvent>,
    tag: GameEvent['_tag'],
  ): ReadonlyArray<GameEvent> =>
    Array.filter(events, event => event._tag === tag),
)
