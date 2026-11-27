import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import {
  Boss,
  type BossMove,
  type GameEvent,
  Invulnerability,
  type Model,
  Phase,
  type PlannedSpawn,
  type Zombie,
} from '#app/model.ts'
import { newPlayerReady } from '#test/model.fixture.ts'
import { zombieOf } from '#test/testing.ts'
import { START_LEVEL } from '#world/level/arena.ts'
import { modifyFocus } from '#world/party/party.ts'
import { FINAL_WAVE, WAVE_PLANS } from '#world/waves/wavePlans.ts'
import { freshFight } from '#world/zombies/boss.ts'
import { ZOMBIE_KINDS, scaledHp } from '#world/zombies/zombies.ts'

export const CENTER_X = START_LEVEL.start.x
export const CENTER_Y = START_LEVEL.start.y - 15
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
    modifyFocus(
      UiStruct.evolve(newPlayerReady, {
        phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }),
        boss: () => boss,
        zombies: () => zombies,
      }),
      {
        player: player =>
          UiStruct.evolve(player, { x: () => CENTER_X, y: () => CENTER_Y }),
      },
    ),
)

export const bossAt: {
  (y: number): (x: number) => Zombie
  (x: number, y: number): Zombie
} = Function.dual(2, (x: number, y: number): Zombie =>
  UiStruct.evolve(zombieOf('Boss', BOSS_ID, x, y, { hp: BOSS_HP }), {
    maxHp: () => BOSS_HP,
  }),
)

export const bossWithHpAt: {
  (x: number, y: number): (hp: number) => Zombie
  (hp: number, x: number, y: number): Zombie
} = Function.dual(3, (hp: number, x: number, y: number): Zombie =>
  UiStruct.evolve(bossAt(x, y), { hp: () => hp }),
)

export const fightOf = (current: Model): typeof Boss.cases.Fighting.Type =>
  Option.getOrThrow(Option.liftPredicate(current.boss, Boss.guards.Fighting))

export const fightingBoss = (move: BossMove): Boss =>
  freshFight(BOSS_ID, move, 1)

export const fightingWith: {
  (
    change: Partial<
      Omit<typeof Boss.cases.Fighting.Type, '_tag' | 'id' | 'move'>
    >,
  ): (move: BossMove) => Boss
  (
    move: BossMove,
    change: Partial<
      Omit<typeof Boss.cases.Fighting.Type, '_tag' | 'id' | 'move'>
    >,
  ): Boss
} = Function.dual(
  2,
  (
    move: BossMove,
    change: Partial<
      Omit<typeof Boss.cases.Fighting.Type, '_tag' | 'id' | 'move'>
    >,
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
      UiStruct.evolve(player, {
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
