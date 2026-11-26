import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { screenToFloorDirection } from '../../render/lens'
import {
  FIRE_INTERVAL_MS,
  FIXED_STEP_MS,
  HIT_STOP_HURT_MS,
  PLAYER_INVULNERABLE_MS,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  SCORE_PER_ZOMBIE,
  ZOMBIE_DYING_MS,
  ZOMBIE_HIT_PULSE_MS,
  ZOMBIE_KNOCKBACK_SPEED,
  ZOMBIE_MAX_HP,
} from '../../shared/constants'
import { RIGHT_ON_SCREEN } from '../../test/lensTesting'
import {
  NORMAL_BITE_GRACE,
  playingModel,
  readyModel,
  withZombies,
} from '../../test/model.fixture'
import {
  FRAME_MS,
  MUZZLE_X,
  RESTART_GRACE_TICKS,
  checkModel,
  holdFire,
  openLobbyByKey,
  releaseFire,
  resolveFocusLobby,
  scoring,
  send,
  storyOf,
  throughIntro,
  tick,
  ticks,
  waitOutFreeze,
  zombieAt,
} from '../../test/testing'
import { START_LEVEL } from '../../world/level/arena'
import { focusOf, modifyFocus } from '../../world/party/party'
import { scoreOf } from '../../world/run/stats'
import { Message } from '../message'
import {
  GameEvent,
  Invulnerability,
  Phase,
  type Zombie,
  ZombieState,
} from '../model'

const dyingZombieAt = (id: number, x: number, y: number): Zombie =>
  UiStruct.evolve(zombieAt(id, x, y, { speed: 0 }), {
    hp: () => 0,
    state: () =>
      ZombieState.Dying({
        remainingMs: ZOMBIE_DYING_MS,
        direction: { x: 1, y: 0 },
      }),
  })
const RIGHT = { x: 1, y: 0 }

// NOTE: the keys walk the screen's ways, turned onto the floor by the lens.
const KEY_LEFT = screenToFloorDirection({ x: -1, y: 0 })
const KEY_DOWN = screenToFloorDirection({ x: 0, y: 1 })
const KEY_UP_RIGHT = screenToFloorDirection({
  x: Math.SQRT1_2,
  y: -Math.SQRT1_2,
})

const GRACE_TICK_MS = 50

describe('movement', () => {
  it.effect('moves the player by speed times the tick', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(playingModel)
      s.pipe(
        send(Message.PressedKey({ code: 'KeyD' })),
        tick(FRAME_MS),
        checkModel(({ seats: [{ player }] }) => {
          expect(player.x).toBeCloseTo(
            START_LEVEL.start.x +
              (RIGHT_ON_SCREEN.x * PLAYER_SPEED * FRAME_MS) / 1000,
          )
          expect(player.y).toBeCloseTo(
            START_LEVEL.start.y +
              (RIGHT_ON_SCREEN.y * PLAYER_SPEED * FRAME_MS) / 1000,
          )
        }),
      )
      return s.model
    }),
  )

  it.effect('clamps a stalled frame delta to 50 ms', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(playingModel)
      s.pipe(
        send(Message.PressedKey({ code: 'KeyA' })),
        tick(5000),
        checkModel(({ seats: [{ player }], elapsedMs }) => {
          expect(player.x).toBeCloseTo(
            START_LEVEL.start.x + KEY_LEFT.x * PLAYER_SPEED * 0.05,
          )
          expect(elapsedMs).toBe(50)
        }),
      )
      return s.model
    }),
  )

  it.effect('ignores frames while the game is not playing', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        send(Message.PressedKey({ code: 'KeyD' })),
        tick(FIXED_STEP_MS),
        checkModel(nextModel => {
          expect(focusOf(nextModel).player.x).toBe(START_LEVEL.start.x)
          expect(nextModel.elapsedMs).toBe(0)
        }),
      )
      return s.model
    }),
  )
})

describe('keyboard intent', () => {
  it.effect('combines held keys into a normalized movement vector', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(playingModel)
      s.pipe(
        send(Message.PressedKey({ code: 'KeyW' })),
        send(Message.PressedKey({ code: 'KeyD' })),
        checkModel(({ seats: [{ intent }] }) => {
          expect(intent.move).toEqual(KEY_UP_RIGHT)
        }),
        send(Message.ReleasedKey({ code: 'KeyW' })),
        checkModel(({ seats: [{ intent }] }) => {
          expect(intent.move).toEqual(RIGHT_ON_SCREEN)
        }),
      )
      return s.model
    }),
  )

  it.effect('window blur releases every held key and the trigger', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(playingModel)
      s.pipe(
        send(Message.PressedKey({ code: 'KeyS' })),
        holdFire,
        checkModel(({ seats: [{ intent }] }) => {
          expect(intent.move).toEqual(KEY_DOWN)
          expect(intent.trigger).toBe('Held')
        }),
        send(Message.BlurredWindow()),
        checkModel(({ input, seats: [{ intent }] }) => {
          expect(input.pressedKeys).toEqual([])
          expect(intent.move).toEqual({ x: 0, y: 0 })
          expect(intent.trigger).toBe('Released')
        }),
      )
      return s.model
    }),
  )

  it.effect(
    'Enter opens the lobby, and Enter again starts the run in the first preparation',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(readyModel)
        s.pipe(
          openLobbyByKey,
          send(Message.PressedKey({ code: 'Enter' })),
          throughIntro,
          checkModel(({ phase }) => {
            expect(Phase.guards.Preparation(phase)).toBe(true)
          }),
        )
        return s.model
      }),
  )
})

describe('firing', () => {
  it.effect(
    'fires at most once per fire interval while the trigger is held',
    () => {
      const frameMs = FIRE_INTERVAL_MS / 5

      return Effect.gen(function* () {
        const s = yield* storyOf(playingModel)
        s.pipe(
          holdFire,
          tick(frameMs),
          checkModel(({ stats }) => {
            expect(stats.shotsFired).toBe(1)
          }),
          ticks(4, frameMs),
          checkModel(({ stats }) => {
            expect(stats.shotsFired).toBe(1)
          }),
          tick(frameMs),
          checkModel(({ stats }) => {
            expect(stats.shotsFired).toBe(2)
          }),
          ticks(5, frameMs),
          checkModel(({ stats }) => {
            expect(stats.shotsFired).toBe(3)
          }),
        )
        return s.model
      })
    },
  )

  it.effect('does not fire while the trigger is released', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(playingModel)
      s.pipe(
        ticks(10, 16),
        checkModel(({ bullets }) => {
          expect(bullets).toEqual([])
        }),
      )
      return s.model
    }),
  )

  it.effect('bullets expire when they leave the arena', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(playingModel)
      s.pipe(
        holdFire,
        tick(FIXED_STEP_MS),
        releaseFire,
        ticks(20, 50),
        checkModel(({ bullets }) => {
          expect(bullets).toEqual([])
        }),
      )
      return s.model
    }),
  )
})

describe('zombies', () => {
  it.effect('chase a nearby player in a straight line', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        withZombies(playingModel, [
          // NOTE: west of the start spot, short of the candelabra.
          zombieAt(100, START_LEVEL.start.x - 40, START_LEVEL.start.y, {
            speed: 20,
          }),
        ]),
      )
      s.pipe(
        tick(50),
        checkModel(({ zombies }) => {
          expect(
            Array.map(zombies, zombie =>
              UiStruct.evolve(zombie, { x: () => 0 }),
            ),
          ).toEqual([zombieAt(100, 0, START_LEVEL.start.y, { speed: 20 })])
          expect(zombies[0]?.x).toBeCloseTo(START_LEVEL.start.x - 39, 9)
        }),
      )
      return s.model
    }),
  )

  it.effect(
    'a zombie takes its health in pistol hits to die and scores on the kill',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          withZombies(playingModel, [
            zombieAt(100, MUZZLE_X, START_LEVEL.start.y, { speed: 0 }),
            zombieAt(101, 20, 20, { speed: 0 }),
          ]),
        )
        s.pipe(
          holdFire,
          tick(FRAME_MS),
          checkModel(({ bullets, zombies, stats }) => {
            expect(bullets).toEqual([])
            expect(Array.map(zombies, ({ id, hp }) => ({ id, hp }))).toEqual([
              { id: 100, hp: ZOMBIE_MAX_HP - 1 },
              { id: 101, hp: ZOMBIE_MAX_HP },
            ])
            expect(Array.map(zombies, ({ state }) => state._tag)).toEqual([
              'Walking',
              'Walking',
            ])
            expect(scoreOf(stats)).toBe(0)
          }),
          ticks(Math.ceil((2 * FIRE_INTERVAL_MS) / FRAME_MS) + 8, FRAME_MS),
          checkModel(({ zombies, stats }) => {
            const struck = Option.getOrThrow(Array.head(zombies))
            expect(struck.hp).toBe(0)
            expect(ZombieState.guards.Dying(struck.state)).toBe(true)
            expect(scoreOf(stats)).toBe(SCORE_PER_ZOMBIE)
          }),
        )
        return s.model
      }),
  )

  it.effect(
    'a hit flashes and knocks the zombie back along the bullet, then both decay',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          withZombies(playingModel, [
            zombieAt(100, MUZZLE_X, START_LEVEL.start.y, { speed: 0 }),
          ]),
        )
        s.pipe(
          holdFire,
          tick(FRAME_MS),
          releaseFire,
          checkModel(({ zombies }) => {
            expect(zombies).toEqual([
              UiStruct.evolve(
                zombieAt(100, MUZZLE_X, START_LEVEL.start.y, { speed: 0 }),
                {
                  hp: () => ZOMBIE_MAX_HP - 1,
                  knockback: () => ({ x: ZOMBIE_KNOCKBACK_SPEED, y: 0 }),
                  hitRemainingMs: () => ZOMBIE_HIT_PULSE_MS,
                },
              ),
            ])
          }),
          tick(FRAME_MS),
          checkModel(({ zombies }) => {
            const zombie = Option.getOrThrow(Array.head(zombies))
            expect(zombie.x).toBeGreaterThan(MUZZLE_X)
            expect(zombie.knockback.x).toBeGreaterThan(0)
            expect(zombie.knockback.x).toBeLessThan(ZOMBIE_KNOCKBACK_SPEED)
            expect(zombie.hitRemainingMs).toBe(ZOMBIE_HIT_PULSE_MS - FRAME_MS)
          }),
          ticks(30, FRAME_MS),
          checkModel(({ zombies }) => {
            const zombie = Option.getOrThrow(Array.head(zombies))
            expect(zombie.knockback).toEqual({ x: 0, y: 0 })
            expect(zombie.hitRemainingMs).toBe(0)
          }),
        )
        return s.model
      }),
  )

  it.effect(
    'a dying zombie does not hurt the player and is removed when its animation ends',
    () => {
      const frameCount = Math.ceil(ZOMBIE_DYING_MS / FRAME_MS)

      return Effect.gen(function* () {
        const s = yield* storyOf(
          withZombies(playingModel, [
            dyingZombieAt(100, START_LEVEL.start.x + 2, START_LEVEL.start.y),
          ]),
        )
        s.pipe(
          ticks(frameCount - 1, FRAME_MS),
          checkModel(({ zombies, seats: [{ player }] }) => {
            expect(Array.map(zombies, ({ id }) => id)).toEqual([100])
            expect(player.hp).toBe(PLAYER_MAX_HP)
            expect(player.invulnerability).toEqual(Invulnerability.Vulnerable())
          }),
          tick(FRAME_MS),
          checkModel(({ zombies, seats: [{ player }] }) => {
            expect(zombies).toEqual([])
            expect(player.hp).toBe(PLAYER_MAX_HP)
          }),
        )
        return s.model
      })
    },
  )

  it.effect('bullets pass through a dying zombie', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        withZombies(playingModel, [
          dyingZombieAt(100, MUZZLE_X, START_LEVEL.start.y),
        ]),
      )
      s.pipe(
        holdFire,
        tick(FRAME_MS),
        checkModel(({ bullets, stats }) => {
          expect(bullets).toHaveLength(1)
          expect(scoreOf(stats)).toBe(0)
        }),
      )
      return s.model
    }),
  )

  it.effect(
    'a zombie that reaches the player costs one heart, knocks the player back, and stays',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          withZombies(playingModel, [
            zombieAt(100, START_LEVEL.start.x + 2, START_LEVEL.start.y, {
              speed: 0,
            }),
          ]),
        )
        s.pipe(
          tick(FRAME_MS),
          checkModel(({ zombies, seats: [{ player }], phase }) => {
            expect(Array.map(zombies, ({ id }) => id)).toEqual([100])
            expect(player.hp).toBe(PLAYER_MAX_HP - 1)
            expect(player.knockback.x).toBeLessThan(0)
            expect(player.invulnerability).toEqual(
              Invulnerability.Invulnerable({
                remainingMs: PLAYER_INVULNERABLE_MS * NORMAL_BITE_GRACE,
                durationMs: PLAYER_INVULNERABLE_MS * NORMAL_BITE_GRACE,
              }),
            )
            expect(Phase.guards.Wave(phase)).toBe(true)
          }),
          waitOutFreeze(HIT_STOP_HURT_MS),
          tick(FRAME_MS),
          checkModel(({ seats: [{ player }] }) => {
            expect(player.x).toBeLessThan(START_LEVEL.start.x)
          }),
        )
        return s.model
      }),
  )

  it.effect(
    'contact during invulnerability costs nothing, and contact after it ends hurts again',
    () => {
      const invulnerableTicks = Math.round(
        (PLAYER_INVULNERABLE_MS * NORMAL_BITE_GRACE) / FRAME_MS,
      )

      return Effect.gen(function* () {
        const s = yield* storyOf(
          withZombies(playingModel, [
            zombieAt(100, START_LEVEL.start.x + 2, START_LEVEL.start.y, {
              speed: 60,
            }),
            zombieAt(101, START_LEVEL.start.x - 2, START_LEVEL.start.y, {
              speed: 60,
            }),
          ]),
        )
        s.pipe(
          tick(FRAME_MS),
          checkModel(({ seats: [{ player }] }) => {
            expect(player.hp).toBe(PLAYER_MAX_HP - 1)
          }),
          waitOutFreeze(HIT_STOP_HURT_MS),
          ticks(invulnerableTicks - 1, FRAME_MS),
          checkModel(({ seats: [{ player }] }) => {
            expect(player.hp).toBe(PLAYER_MAX_HP - 1)
            expect(
              Invulnerability.guards.Invulnerable(player.invulnerability),
            ).toBe(true)
          }),
          ticks(2, FRAME_MS),
          checkModel(({ seats: [{ player }] }) => {
            expect(player.hp).toBe(PLAYER_MAX_HP - 2)
          }),
        )
        return s.model
      })
    },
  )

  it.effect(
    'the game ends when HP reaches zero, and Enter starts a fresh run',
    () => {
      const lastHeartModel = withZombies(
        modifyFocus(UiStruct.evolve(playingModel, { stats: scoring(120) }), {
          player: player => UiStruct.evolve(player, { hp: () => 1 }),
        }),
        [
          zombieAt(100, START_LEVEL.start.x, START_LEVEL.start.y + 3, {
            speed: 20,
          }),
        ],
      )

      return Effect.gen(function* () {
        const s = yield* storyOf(lastHeartModel)
        s.pipe(
          tick(FRAME_MS),
          checkModel(({ phase, seats: [{ player }], stats }) => {
            expect(phase).toEqual(Phase.GameOver({ wave: 1 }))
            expect(player.hp).toBe(0)
            expect(scoreOf(stats)).toBe(120)
          }),
          tick(FRAME_MS),
          checkModel(({ elapsedMs }) => {
            expect(elapsedMs).toBe(FRAME_MS)
          }),
          ticks(RESTART_GRACE_TICKS, GRACE_TICK_MS),
          send(Message.PressedKey({ code: 'Enter' })),
          throughIntro,
          checkModel(({ phase, seats: [{ player }], stats, zombies }) => {
            expect(Phase.guards.Preparation(phase)).toBe(true)
            expect(player.hp).toBe(PLAYER_MAX_HP)
            expect(scoreOf(stats)).toBe(0)
            expect(zombies).toEqual([])
          }),
        )
        return s.model
      })
    },
  )
})

describe('game events', () => {
  it.effect(
    'a frame records what happened in it and the next frame clears them',
    () => {
      const shot = { x: START_LEVEL.start.x + 6, y: START_LEVEL.start.y }
      const zombieX = MUZZLE_X

      return Effect.gen(function* () {
        const s = yield* storyOf(
          withZombies(playingModel, [
            UiStruct.evolve(
              zombieAt(100, zombieX, START_LEVEL.start.y, { speed: 0 }),
              {
                hp: () => 1,
              },
            ),
          ]),
        )
        s.pipe(
          holdFire,
          tick(FRAME_MS),
          releaseFire,
          checkModel(({ frameEvents }) => {
            expect(Array.map(frameEvents, ({ _tag }) => _tag)).toEqual([
              'Fired',
              'ZombieHit',
              'ZombieKilled',
            ])
            expect(Array.head(frameEvents)).toEqual(
              Option.some(
                GameEvent.Fired({
                  ...shot,
                  direction: RIGHT,
                  weapon: 'Pistol',
                  maybeShooter: Option.none(),
                }),
              ),
            )
            expect(Array.last(frameEvents)).toEqual(
              Option.some(
                GameEvent.ZombieKilled({
                  x: zombieX,
                  y: START_LEVEL.start.y,
                  direction: RIGHT,
                  kind: 'Shambler',
                  maybeKiller: Option.none(),
                  source: 'Pistol',
                }),
              ),
            )
          }),
          tick(FRAME_MS),
          checkModel(({ frameEvents }) => {
            expect(frameEvents).toEqual([])
          }),
        )
        return s.model
      })
    },
  )

  it.effect('a contact frame records PlayerHurt once', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        withZombies(playingModel, [
          zombieAt(100, START_LEVEL.start.x + 2, START_LEVEL.start.y, {
            speed: 0,
          }),
        ]),
      )
      s.pipe(
        tick(FRAME_MS),
        checkModel(({ frameEvents }) => {
          expect(frameEvents).toEqual([
            GameEvent.PlayerHurt({
              x: START_LEVEL.start.x,
              y: START_LEVEL.start.y,
              direction: { x: -1, y: 0 },
              source: 'Shambler',
            }),
          ])
        }),
        tick(FRAME_MS),
        checkModel(({ frameEvents }) => {
          expect(frameEvents).toEqual([])
        }),
      )
      return s.model
    }),
  )
})

describe('determinism', () => {
  const playSession = (seed: number) =>
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* storyOf(
          UiStruct.evolve(readyModel, { rngState: () => seed }),
        )
        s.pipe(
          send(Message.PressedKey({ code: 'Enter' })),
          resolveFocusLobby(),
          send(Message.PressedKey({ code: 'Enter' })),
          send(Message.ReleasedKey({ code: 'Enter' })),
          throughIntro,
          send(Message.PressedKey({ code: 'Enter' })),
          holdFire,
          send(Message.PressedKey({ code: 'KeyW' })),
          ticks(120, 16),
          send(Message.ReleasedKey({ code: 'KeyW' })),
          send(Message.PressedKey({ code: 'KeyA' })),
          ticks(120, 33),
        )
        return s.model
      }),
    )

  it.effect('the same seed and Messages produce the same Model', () =>
    Effect.gen(function* () {
      const first = yield* playSession(1234)
      const second = yield* playSession(1234)

      expect(first.zombies.length + scoreOf(first.stats)).toBeGreaterThan(0)
      expect(second).toEqual(first)
    }),
  )

  it.effect('a different seed produces a different game', () =>
    Effect.gen(function* () {
      const first = yield* playSession(1234)
      const other = yield* playSession(98765)
      expect(other.zombies).not.toEqual(first.zombies)
    }),
  )
})
