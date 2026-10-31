import { Array, Option, Result } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR, doorSpawnPoint, nearestDoor } from './arena'
import {
  DOOR_HALF_WIDTH_PX,
  FIXED_STEP_MS,
  MAX_BLASTS_PER_FRAME,
  PLAYER_MAX_HP,
  ZOMBIE_BUMP_SPEED,
  ZOMBIE_KNOCKBACK_SPEED,
} from './constants'
import { rollSpawns } from './endlessWaves'
import { vectorLength } from './geometry'
import { update } from './main'
import {
  type Bullet,
  GameEvent,
  Invulnerability,
  type Model,
  Phase,
  Pierce,
  type PlannedSpawn,
  type Zombie,
  type ZombieKind,
  ZombieState,
} from './model'
import { DISTANT_SPAWN, quietWave, withActors } from './model.fixture'
import { blastFrames, recordTicks, tick, ticks, zombieOf } from './testing'
import {
  FINAL_WAVE,
  type KindWeight,
  WAVE_PLANS,
  debutKinds,
  pickKind,
} from './wavePlans'
import {
  Behavior,
  ZOMBIE_KINDS,
  ZOMBIE_KIND_ORDER,
  isFloorKind,
} from './zombies'

const FRAME_MS = FIXED_STEP_MS
const LONG_FRAME_MS = 50
const CENTER_X = PARLOUR.width / 2
const CENTER_Y = PARLOUR.height / 2

const pistolInto = (id: number, zombie: Zombie): Bullet => ({
  id,
  x: zombie.x,
  y: zombie.y,
  velocityX: 1,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
  damage: 1,
  knockback: 110,
  glaze: 'Plain',
  pierce: Pierce.Stops(),
})

const pistolsInto = (
  firstId: number,
  count: number,
  zombie: Zombie,
): ReadonlyArray<Bullet> =>
  Array.makeBy(count, index => pistolInto(firstId + index, zombie))

const withScene = (
  zombies: ReadonlyArray<Zombie>,
  bullets: ReadonlyArray<Bullet> = [],
): Model => withActors(quietWave(1), zombies, bullets)

const bomberOf = (kind: ZombieKind) =>
  Behavior.match(ZOMBIE_KINDS[kind].behavior, {
    Brawler: () => {
      throw new Error(`${kind} is not a bomber`)
    },
    Bomber: bomber => bomber,
    Thrower: () => {
      throw new Error(`${kind} is not a bomber`)
    },
    Crawler: () => {
      throw new Error(`${kind} is not a bomber`)
    },
  })

const EXPLODER = bomberOf('Exploder')

const MIN_CHAIN_STAGGER_MS = 100
const MIN_CHAIN_STAGGER_FRAMES = 6

const explosionsIn = (frame: Model): number =>
  Array.filter(frame.frameEvents, GameEvent.guards.Exploded).length

describe('the kind table', () => {
  test('each kind that walks in spawns at its door with its table stats', () => {
    const doorKinds = Array.filter(
      ZOMBIE_KIND_ORDER,
      kind => !isFloorKind(kind),
    )
    const spawns: ReadonlyArray<PlannedSpawn> = Array.map(
      doorKinds,
      (kind, index) => ({
        atMs: 0,
        kind,
        door: Option.getOrThrow(
          Array.get(PARLOUR.doorIds, index % PARLOUR.doorIds.length),
        ),
        offset: 5,
        speedScale: 1.1,
        hpScale: 1,
        pack: 0,
        formation: 'Squad',
      }),
    )

    story(
      update,
      given(
        modifyFields(quietWave(1), {
          phase: () =>
            Phase.Wave({
              wave: 3,
              elapsedMs: 0,
              spawns: [...spawns, DISTANT_SPAWN],
            }),
        }),
      ),
      tick(FRAME_MS),
      model(({ zombies }) => {
        expect(Array.map(zombies, ({ kind }) => kind)).toEqual(doorKinds)
        Array.forEach(zombies, (zombie, index) => {
          const stats = ZOMBIE_KINDS[zombie.kind]
          const spawn = Option.getOrThrow(Array.get(spawns, index))
          const room = DOOR_HALF_WIDTH_PX - stats.radius
          const nearestPoint = doorSpawnPoint(
            PARLOUR,
            spawn.door,
            Math.min(spawn.offset, room),
          )
          expect(zombie.hp).toBe(stats.hp)
          expect(zombie.speed).toBeGreaterThanOrEqual(stats.speedMin * 1.1)
          expect(zombie.speed).toBeLessThanOrEqual(stats.speedMax * 1.1)
          expect(nearestDoor(PARLOUR, zombie).id).toBe(spawn.door)
          expect(
            Math.hypot(zombie.x - nearestPoint.x, zombie.y - nearestPoint.y),
          ).toBeLessThan(2)
        })
      }),
    )
  })

  test('a Runner and a Tank each take their full health in pistol hits', () => {
    const runner = zombieOf('Runner', 1, 200, 60)
    const tank = zombieOf('Tank', 2, 100, 100)
    const tankHp = ZOMBIE_KINDS.Tank.hp

    story(
      update,
      given(
        withScene(
          [runner, tank],
          [
            ...pistolsInto(10, ZOMBIE_KINDS.Runner.hp, runner),
            ...pistolsInto(20, tankHp - 1, tank),
          ],
        ),
      ),
      tick(FRAME_MS),
      model(({ zombies }) => {
        const [shotRunner, shotTank] = zombies
        expect(shotRunner?.state._tag).toBe('Dying')
        expect(shotTank?.hp).toBe(1)
        expect(shotTank?.state).toEqual(ZombieState.Walking())
      }),
    )

    story(
      update,
      given(withScene([tank], pistolsInto(20, tankHp, tank))),
      tick(FRAME_MS),
      model(({ zombies, wallet }) => {
        expect(Array.map(zombies, ({ state }) => state._tag)).toEqual(['Dying'])
        expect(wallet.balance).toBe(ZOMBIE_KINDS.Tank.bounty)
      }),
    )
  })

  test('a fast bullet in a long frame still hits a Hotfoot it passes through', () => {
    const runner = zombieOf('Runner', 1, 200, 60)
    const grazing: Bullet = {
      id: 10,
      x: 192,
      y: 63.5,
      velocityX: 240,
      velocityY: 0,
      remainingMs: 900,
      weapon: 'Pistol',
      damage: 1,
      knockback: 110,
      glaze: 'Plain',
      pierce: Pierce.Stops(),
    }

    story(
      update,
      given(withScene([runner], [grazing])),
      tick(LONG_FRAME_MS),
      model(({ zombies, bullets }) => {
        expect(Array.map(zombies, ({ hp }) => hp)).toEqual([
          ZOMBIE_KINDS.Runner.hp - 1,
        ])
        expect(bullets).toEqual([])
      }),
    )
  })

  test('a bullet hits the first zombie along its path in a long frame', () => {
    const near = zombieOf('Shambler', 1, 200, 60)
    const far = zombieOf('Shambler', 2, 208, 60)
    const piercing: Bullet = {
      id: 10,
      x: 194,
      y: 60,
      velocityX: 240,
      velocityY: 0,
      remainingMs: 900,
      weapon: 'Pistol',
      damage: 1,
      knockback: 110,
      glaze: 'Plain',
      pierce: Pierce.Stops(),
    }

    story(
      update,
      given(withScene([far, near], [piercing])),
      tick(LONG_FRAME_MS),
      model(({ zombies }) => {
        expect(Array.map(zombies, ({ id, hp }) => [id, hp])).toEqual([
          [2, ZOMBIE_KINDS.Shambler.hp],
          [1, ZOMBIE_KINDS.Shambler.hp - 1],
        ])
      }),
    )
  })

  test('a Tank bite costs two hearts and the Tank barely flinches', () => {
    const tank = zombieOf('Tank', 1, CENTER_X + 6, CENTER_Y)
    story(
      update,
      given(withScene([tank])),
      tick(FRAME_MS),
      model(({ player, zombies }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP - 2)
        const bitten = Option.getOrThrow(Array.head(zombies))
        expect(vectorLength(bitten.knockback)).toBeCloseTo(
          ZOMBIE_BUMP_SPEED * ZOMBIE_KINDS.Tank.knockbackScale,
          0,
        )
      }),
    )

    const shambler = zombieOf('Shambler', 1, 200, 60)
    const sameShotTank = zombieOf('Tank', 2, 100, 100)
    story(
      update,
      given(
        withScene(
          [shambler, sameShotTank],
          [pistolInto(10, shambler), pistolInto(11, sameShotTank)],
        ),
      ),
      tick(FRAME_MS),
      model(({ zombies }) => {
        const [shotShambler, shotTank] = Array.map(zombies, ({ knockback }) =>
          vectorLength(knockback),
        )
        expect(shotShambler).toBeGreaterThan(ZOMBIE_KNOCKBACK_SPEED * 0.8)
        expect(shotTank).toBeLessThan(ZOMBIE_KNOCKBACK_SPEED * 0.2)
      }),
    )
  })

  test('zombies of different sizes push apart to their combined radius, the light one more', () => {
    const tank = zombieOf('Tank', 1, 100, 100)
    const runner = zombieOf('Runner', 2, 102, 100)
    story(
      update,
      given(
        modifyFields(withScene([tank, runner]), {
          player: player =>
            modifyFields(player, { x: () => 280, y: () => 150 }),
        }),
      ),
      ...ticks(40, FRAME_MS),
      model(({ zombies }) => {
        const [pushedTank, pushedRunner] = zombies
        const gap = Math.hypot(
          (pushedTank?.x ?? 0) - (pushedRunner?.x ?? 0),
          (pushedTank?.y ?? 0) - (pushedRunner?.y ?? 0),
        )
        expect(gap).toBeGreaterThan(
          ZOMBIE_KINDS.Tank.radius + ZOMBIE_KINDS.Runner.radius - 1,
        )
        expect(Math.abs((pushedRunner?.x ?? 0) - 102)).toBeGreaterThan(
          Math.abs((pushedTank?.x ?? 0) - 100) * 3,
        )
      }),
    )
  })
})

describe('exploders', () => {
  test('a shot Exploder fuses, then bursts once, hurting the player once and the zombies nearby', () => {
    const left = zombieOf('Exploder', 1, CENTER_X + 18, CENTER_Y, { speed: 0 })
    const right = zombieOf('Exploder', 2, CENTER_X + 18, CENTER_Y + 8, {
      speed: 0,
    })
    const shambler = zombieOf('Shambler', 3, CENTER_X + 32, CENTER_Y)
    const tank = zombieOf('Tank', 4, CENTER_X + 18, CENTER_Y - 18)
    const frames: Array<Model> = []

    story(
      update,
      given(
        withScene(
          [left, right, shambler, tank],
          Array.flatten([
            pistolsInto(10, ZOMBIE_KINDS.Exploder.hp, left),
            pistolsInto(20, ZOMBIE_KINDS.Exploder.hp, right),
          ]),
        ),
      ),
      tick(FRAME_MS),
      model(({ zombies, wallet }) => {
        expect(
          Array.map(Array.take(zombies, 2), ({ state }) => state._tag),
        ).toEqual(['Fusing', 'Fusing'])
        expect(wallet.balance).toBe(2 * ZOMBIE_KINDS.Exploder.bounty)
      }),
      ...recordTicks(40, FRAME_MS, frames),
    )

    const bursts = blastFrames(frames)
    expect(Array.map(bursts, explosionsIn)).toEqual([2])
    const burst = Option.getOrThrow(Array.head(bursts))
    expect(
      Array.filter(burst.frameEvents, GameEvent.guards.PlayerHurt),
    ).toHaveLength(1)
    expect(burst.player.hp).toBe(PLAYER_MAX_HP - EXPLODER.playerDamage)
    expect(
      Invulnerability.guards.Invulnerable(burst.player.invulnerability),
    ).toBe(true)
    expect(Array.map(burst.zombies, ({ id }) => id)).toEqual([3, 4])
    const [blastedShambler, blastedTank] = burst.zombies
    expect(blastedShambler?.state._tag).toBe('Dying')
    expect(blastedTank?.hp).toBe(
      ZOMBIE_KINDS.Tank.hp - 2 * EXPLODER.zombieDamage,
    )
    expect(Option.getOrThrow(Array.last(frames)).player.hp).toBe(
      PLAYER_MAX_HP - EXPLODER.playerDamage,
    )
    expect(Array.isReadonlyArrayNonEmpty(burst.blasts)).toBe(true)
  })

  test('a shot Exploder sprays goo and never blood', () => {
    const gasbag = zombieOf('Exploder', 1, 200, 60)

    story(
      update,
      given(
        withScene([gasbag], pistolsInto(10, ZOMBIE_KINDS.Exploder.hp, gasbag)),
      ),
      tick(FRAME_MS),
      model(({ zombies, particles }) => {
        expect(Array.map(zombies, ({ state }) => state._tag)).toEqual([
          'Fusing',
        ])
        expect(Array.isReadonlyArrayNonEmpty(particles)).toBe(true)
        expect(Array.filter(particles, ({ kind }) => kind === 'Blood')).toEqual(
          [],
        )
      }),
    )
  })

  test('two Exploders chain, the second bursting a fuse later', () => {
    const first = zombieOf('Exploder', 1, 200, 60)
    const second = zombieOf('Exploder', 2, 216, 60)
    const frames: Array<Model> = []

    story(
      update,
      given(
        withScene(
          [first, second],
          pistolsInto(10, ZOMBIE_KINDS.Exploder.hp, first),
        ),
      ),
      ...recordTicks(60, FRAME_MS, frames),
    )

    const bursts = blastFrames(frames)
    expect(Array.map(bursts, explosionsIn)).toEqual([1, 1])
    const [firstBurst, secondBurst] = bursts
    const burstFrameIndexes = Array.filterMap(frames, (frame, index) =>
      explosionsIn(frame) > 0 ? Result.succeed(index) : Result.failVoid,
    )
    expect(
      (secondBurst?.elapsedMs ?? 0) - (firstBurst?.elapsedMs ?? 0),
    ).toBeGreaterThanOrEqual(MIN_CHAIN_STAGGER_MS)
    const [firstIndex, secondIndex] = burstFrameIndexes
    expect((secondIndex ?? 0) - (firstIndex ?? 0)).toBeGreaterThanOrEqual(
      MIN_CHAIN_STAGGER_FRAMES,
    )
    expect(Option.getOrThrow(Array.last(frames)).zombies).toEqual([])
    expect(Option.getOrThrow(Array.last(frames)).wallet.balance).toBe(
      2 * ZOMBIE_KINDS.Exploder.bounty,
    )
  })

  test('a long chain bursts at most the cap in one frame and queues the rest', () => {
    const cluster = Array.makeBy(6, index =>
      zombieOf('Exploder', index + 1, 200 + (index % 3) * 3, 80 + index),
    )
    const frames: Array<Model> = []

    story(
      update,
      given(
        withScene(
          cluster,
          Array.flatMap(cluster, (zombie, index) =>
            pistolsInto(10 + index * 2, 2, zombie),
          ),
        ),
      ),
      ...recordTicks(80, FRAME_MS, frames),
    )

    const counts = Array.map(blastFrames(frames), explosionsIn)
    expect(Array.reduce(counts, 0, (sum, count) => sum + count)).toBe(6)
    expect(Array.every(counts, count => count <= MAX_BLASTS_PER_FRAME)).toBe(
      true,
    )
  })

  test('an Exploder that reaches the player pops itself without paying out', () => {
    const exploder = zombieOf('Exploder', 1, CENTER_X + 6, CENTER_Y)
    const frames: Array<Model> = []

    story(
      update,
      given(withScene([exploder])),
      tick(FRAME_MS),
      model(({ zombies, player, frameEvents }) => {
        expect(Array.map(zombies, ({ state }) => state)).toEqual([
          ZombieState.Fusing({ remainingMs: EXPLODER.contactFuseMs }),
        ])
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(frameEvents).toEqual([])
      }),
      ...recordTicks(30, FRAME_MS, frames),
    )

    const last = Option.getOrThrow(Array.last(frames))
    expect(Array.map(blastFrames(frames), explosionsIn)).toEqual([1])
    expect(last.player.hp).toBe(PLAYER_MAX_HP - EXPLODER.playerDamage)
    expect(last.zombies).toEqual([])
    expect(last.wallet.balance).toBe(0)
    expect(
      Array.some(
        Array.flatMap(frames, ({ frameEvents }) => frameEvents),
        GameEvent.guards.ZombieKilled,
      ),
    ).toBe(false)
  })
})

describe('spawn tables', () => {
  const kindsOf = (spawns: ReadonlyArray<PlannedSpawn>, kind: ZombieKind) =>
    Array.filter(spawns, spawn => spawn.kind === kind).length

  test('a kind is drawn by weight from a roll', () => {
    const mix: Array.NonEmptyReadonlyArray<KindWeight> = [
      { kind: 'Shambler', weight: 3 },
      { kind: 'Runner', weight: 1 },
    ]
    expect(pickKind(mix, 0)).toBe('Shambler')
    expect(pickKind(mix, 0.74)).toBe('Shambler')
    expect(pickKind(mix, 0.76)).toBe('Runner')
    expect(pickKind(mix, 0.999)).toBe('Runner')
  })

  test('each wave draws only kinds from its table, the same way for the same seed', () => {
    Array.forEach(
      Array.makeBy(FINAL_WAVE, index => index + 1),
      wave => {
        const [, first] = rollSpawns(31337, wave)
        const [, again] = rollSpawns(31337, wave)
        const plan = Option.getOrThrow(Array.get(WAVE_PLANS, wave - 1))
        const allowed = Array.flatMap(plan.groups, ({ mix }) =>
          Array.map(mix, ({ kind }) => kind),
        )
        expect(again).toEqual(first)
        expect(
          Array.every(first, ({ kind }) => Array.contains(allowed, kind)),
        ).toBe(true)
      },
    )
  })

  test('the arc opens with Groaners and introduces one new kind at a time', () => {
    const [, tutorial] = rollSpawns(99, 1)
    expect(Array.every(tutorial, ({ kind }) => kind === 'Shambler')).toBe(true)
    expect(Array.makeBy(FINAL_WAVE, index => debutKinds(index + 1))).toEqual([
      ['Shambler'],
      ['Runner'],
      [],
      ['Exploder'],
      ['Tank'],
      ['Thrower'],
      ['Crawler'],
      [],
      [],
      [],
    ])
    Array.forEach([1, 2, 3, 99, 31337], seed => {
      Array.forEach([2, 4, 5, 6, 7], wave => {
        const [, spawns] = rollSpawns(seed, wave)
        Array.forEach(debutKinds(wave), kind => {
          expect(kindsOf(spawns, kind)).toBeGreaterThan(0)
        })
      })
    })
  })

  test('the finale is a Tank-heavy horde with the boss on top for every seed', () => {
    const healthOf = (spawns: ReadonlyArray<PlannedSpawn>): number =>
      Array.reduce(spawns, 0, (sum, { kind }) => sum + ZOMBIE_KINDS[kind].hp)
    Array.forEach([1, 2, 3, 99, 31337], seed => {
      const [, finale] = rollSpawns(seed, FINAL_WAVE)
      const [, before] = rollSpawns(seed, FINAL_WAVE - 1)
      expect(kindsOf(finale, 'Tank')).toBe(3)
      expect(kindsOf(finale, 'Tank')).toBeGreaterThan(kindsOf(before, 'Tank'))
      expect(healthOf(finale) + ZOMBIE_KINDS.Boss.hp).toBeGreaterThan(
        healthOf(before),
      )
      expect(Array.some(finale, ({ formation }) => formation === 'Horde')).toBe(
        true,
      )
    })
  })
})
