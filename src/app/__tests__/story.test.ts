import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

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
import {
  NORMAL_BITE_GRACE,
  playingModel,
  readyModel,
  withZombies,
} from '../../test/model.fixture'
import {
  APPLICATION,
  FRAME_MS,
  MUZZLE_X,
  RESTART_GRACE_TICKS,
  holdFire,
  openLobbyByKey,
  releaseFire,
  resolveFocusLobby,
  scoring,
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
  modifyFields(zombieAt(id, x, y, { speed: 0 }), {
    hp: () => 0,
    state: () =>
      ZombieState.Dying({
        remainingMs: ZOMBIE_DYING_MS,
        direction: { x: 1, y: 0 },
      }),
  })
const RIGHT = { x: 1, y: 0 }

const GRACE_TICK_MS = 50

describe('movement', () => {
  it.effect('moves the player by speed times the tick', () =>
    Story.story(
      APPLICATION,
      Story.given(playingModel),
      Story.message(Message.PressedKey({ code: 'KeyD' })),
      tick(FRAME_MS),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.x).toBeCloseTo(
          START_LEVEL.start.x + (PLAYER_SPEED * FRAME_MS) / 1000,
        )
        expect(player.y).toBe(START_LEVEL.start.y)
      }),
    ),
  )

  it.effect('clamps a stalled frame delta to 50 ms', () =>
    Story.story(
      APPLICATION,
      Story.given(playingModel),
      Story.message(Message.PressedKey({ code: 'KeyA' })),
      tick(5000),
      Story.model(({ seats: [{ player }], elapsedMs }) => {
        expect(player.x).toBeCloseTo(START_LEVEL.start.x - PLAYER_SPEED * 0.05)
        expect(elapsedMs).toBe(50)
      }),
    ),
  )

  it.effect('ignores frames while the game is not playing', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      Story.message(Message.PressedKey({ code: 'KeyD' })),
      tick(FIXED_STEP_MS),
      Story.model(nextModel => {
        expect(focusOf(nextModel).player.x).toBe(START_LEVEL.start.x)
        expect(nextModel.elapsedMs).toBe(0)
      }),
    ),
  )
})

describe('keyboard intent', () => {
  it.effect('combines held keys into a normalized movement vector', () =>
    Story.story(
      APPLICATION,
      Story.given(playingModel),
      Story.message(Message.PressedKey({ code: 'KeyW' })),
      Story.message(Message.PressedKey({ code: 'KeyD' })),
      Story.model(({ seats: [{ intent }] }) => {
        expect(intent.move.x).toBeCloseTo(Math.SQRT1_2)
        expect(intent.move.y).toBeCloseTo(-Math.SQRT1_2)
      }),
      Story.message(Message.ReleasedKey({ code: 'KeyW' })),
      Story.model(({ seats: [{ intent }] }) => {
        expect(intent.move).toEqual({ x: 1, y: 0 })
      }),
    ),
  )

  it.effect('window blur releases every held key and the trigger', () =>
    Story.story(
      APPLICATION,
      Story.given(playingModel),
      Story.message(Message.PressedKey({ code: 'KeyS' })),
      holdFire,
      Story.model(({ seats: [{ intent }] }) => {
        expect(intent.move).toEqual({ x: 0, y: 1 })
        expect(intent.trigger).toBe('Held')
      }),
      Story.message(Message.BlurredWindow()),
      Story.model(({ input, seats: [{ intent }] }) => {
        expect(input.pressedKeys).toEqual([])
        expect(intent.move).toEqual({ x: 0, y: 0 })
        expect(intent.trigger).toBe('Released')
      }),
    ),
  )

  it.effect(
    'Enter opens the lobby, and Enter again starts the run in the first preparation',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyModel),
        openLobbyByKey,
        Story.message(Message.PressedKey({ code: 'Enter' })),
        throughIntro,
        Story.model(({ phase }) => {
          expect(Phase.guards.Preparation(phase)).toBe(true)
        }),
      ),
  )
})

describe('firing', () => {
  it.effect(
    'fires at most once per fire interval while the trigger is held',
    () => {
      const frameMs = FIRE_INTERVAL_MS / 5

      return Story.story(
        APPLICATION,
        Story.given(playingModel),
        holdFire,
        tick(frameMs),
        Story.model(({ stats }) => {
          expect(stats.shotsFired).toBe(1)
        }),
        ...ticks(4, frameMs),
        Story.model(({ stats }) => {
          expect(stats.shotsFired).toBe(1)
        }),
        tick(frameMs),
        Story.model(({ stats }) => {
          expect(stats.shotsFired).toBe(2)
        }),
        ...ticks(5, frameMs),
        Story.model(({ stats }) => {
          expect(stats.shotsFired).toBe(3)
        }),
      )
    },
  )

  it.effect('does not fire while the trigger is released', () =>
    Story.story(
      APPLICATION,
      Story.given(playingModel),
      ...ticks(10, 16),
      Story.model(({ bullets }) => {
        expect(bullets).toEqual([])
      }),
    ),
  )

  it.effect('bullets expire when they leave the arena', () =>
    Story.story(
      APPLICATION,
      Story.given(playingModel),
      holdFire,
      tick(FIXED_STEP_MS),
      releaseFire,
      ...ticks(20, 50),
      Story.model(({ bullets }) => {
        expect(bullets).toEqual([])
      }),
    ),
  )
})

describe('zombies', () => {
  it.effect('chase a nearby player in a straight line', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withZombies(playingModel, [
          // NOTE: west of the start spot, short of the candelabra.
          zombieAt(100, START_LEVEL.start.x - 40, START_LEVEL.start.y, {
            speed: 20,
          }),
        ]),
      ),
      tick(50),
      Story.model(({ zombies }) => {
        expect(
          Array.map(zombies, zombie => modifyFields(zombie, { x: () => 0 })),
        ).toEqual([zombieAt(100, 0, START_LEVEL.start.y, { speed: 20 })])
        expect(zombies[0]?.x).toBeCloseTo(START_LEVEL.start.x - 39, 9)
      }),
    ),
  )

  it.effect(
    'a zombie takes its health in pistol hits to die and scores on the kill',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          withZombies(playingModel, [
            zombieAt(100, MUZZLE_X, START_LEVEL.start.y, { speed: 0 }),
            zombieAt(101, 20, 20, { speed: 0 }),
          ]),
        ),
        holdFire,
        tick(FRAME_MS),
        Story.model(({ bullets, zombies, stats }) => {
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
        ...ticks(Math.ceil((2 * FIRE_INTERVAL_MS) / FRAME_MS) + 8, FRAME_MS),
        Story.model(({ zombies, stats }) => {
          const struck = Option.getOrThrow(Array.head(zombies))
          expect(struck.hp).toBe(0)
          expect(ZombieState.guards.Dying(struck.state)).toBe(true)
          expect(scoreOf(stats)).toBe(SCORE_PER_ZOMBIE)
        }),
      ),
  )

  it.effect(
    'a hit flashes and knocks the zombie back along the bullet, then both decay',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          withZombies(playingModel, [
            zombieAt(100, MUZZLE_X, START_LEVEL.start.y, { speed: 0 }),
          ]),
        ),
        holdFire,
        tick(FRAME_MS),
        releaseFire,
        Story.model(({ zombies }) => {
          expect(zombies).toEqual([
            modifyFields(
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
        Story.model(({ zombies }) => {
          const zombie = Option.getOrThrow(Array.head(zombies))
          expect(zombie.x).toBeGreaterThan(MUZZLE_X)
          expect(zombie.knockback.x).toBeGreaterThan(0)
          expect(zombie.knockback.x).toBeLessThan(ZOMBIE_KNOCKBACK_SPEED)
          expect(zombie.hitRemainingMs).toBe(ZOMBIE_HIT_PULSE_MS - FRAME_MS)
        }),
        ...ticks(30, FRAME_MS),
        Story.model(({ zombies }) => {
          const zombie = Option.getOrThrow(Array.head(zombies))
          expect(zombie.knockback).toEqual({ x: 0, y: 0 })
          expect(zombie.hitRemainingMs).toBe(0)
        }),
      ),
  )

  it.effect(
    'a dying zombie does not hurt the player and is removed when its animation ends',
    () => {
      const frameCount = Math.ceil(ZOMBIE_DYING_MS / FRAME_MS)

      return Story.story(
        APPLICATION,
        Story.given(
          withZombies(playingModel, [
            dyingZombieAt(100, START_LEVEL.start.x + 2, START_LEVEL.start.y),
          ]),
        ),
        ...ticks(frameCount - 1, FRAME_MS),
        Story.model(({ zombies, seats: [{ player }] }) => {
          expect(Array.map(zombies, ({ id }) => id)).toEqual([100])
          expect(player.hp).toBe(PLAYER_MAX_HP)
          expect(player.invulnerability).toEqual(Invulnerability.Vulnerable())
        }),
        tick(FRAME_MS),
        Story.model(({ zombies, seats: [{ player }] }) => {
          expect(zombies).toEqual([])
          expect(player.hp).toBe(PLAYER_MAX_HP)
        }),
      )
    },
  )

  it.effect('bullets pass through a dying zombie', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withZombies(playingModel, [
          dyingZombieAt(100, MUZZLE_X, START_LEVEL.start.y),
        ]),
      ),
      holdFire,
      tick(FRAME_MS),
      Story.model(({ bullets, stats }) => {
        expect(bullets).toHaveLength(1)
        expect(scoreOf(stats)).toBe(0)
      }),
    ),
  )

  it.effect(
    'a zombie that reaches the player costs one heart, knocks the player back, and stays',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          withZombies(playingModel, [
            zombieAt(100, START_LEVEL.start.x + 2, START_LEVEL.start.y, {
              speed: 0,
            }),
          ]),
        ),
        tick(FRAME_MS),
        Story.model(({ zombies, seats: [{ player }], phase }) => {
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
        ...waitOutFreeze(HIT_STOP_HURT_MS),
        tick(FRAME_MS),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.x).toBeLessThan(START_LEVEL.start.x)
        }),
      ),
  )

  it.effect(
    'contact during invulnerability costs nothing, and contact after it ends hurts again',
    () => {
      const invulnerableTicks = Math.round(
        (PLAYER_INVULNERABLE_MS * NORMAL_BITE_GRACE) / FRAME_MS,
      )

      return Story.story(
        APPLICATION,
        Story.given(
          withZombies(playingModel, [
            zombieAt(100, START_LEVEL.start.x + 2, START_LEVEL.start.y, {
              speed: 60,
            }),
            zombieAt(101, START_LEVEL.start.x - 2, START_LEVEL.start.y, {
              speed: 60,
            }),
          ]),
        ),
        tick(FRAME_MS),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.hp).toBe(PLAYER_MAX_HP - 1)
        }),
        ...waitOutFreeze(HIT_STOP_HURT_MS),
        ...ticks(invulnerableTicks - 1, FRAME_MS),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.hp).toBe(PLAYER_MAX_HP - 1)
          expect(
            Invulnerability.guards.Invulnerable(player.invulnerability),
          ).toBe(true)
        }),
        ...ticks(2, FRAME_MS),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.hp).toBe(PLAYER_MAX_HP - 2)
        }),
      )
    },
  )

  it.effect(
    'the game ends when HP reaches zero, and Enter starts a fresh run',
    () => {
      const lastHeartModel = withZombies(
        modifyFocus(modifyFields(playingModel, { stats: scoring(120) }), {
          player: player => modifyFields(player, { hp: () => 1 }),
        }),
        [
          zombieAt(100, START_LEVEL.start.x, START_LEVEL.start.y + 3, {
            speed: 20,
          }),
        ],
      )

      return Story.story(
        APPLICATION,
        Story.given(lastHeartModel),
        tick(FRAME_MS),
        Story.model(({ phase, seats: [{ player }], stats }) => {
          expect(phase).toEqual(Phase.GameOver({ wave: 1 }))
          expect(player.hp).toBe(0)
          expect(scoreOf(stats)).toBe(120)
        }),
        tick(FRAME_MS),
        Story.model(({ elapsedMs }) => {
          expect(elapsedMs).toBe(FRAME_MS)
        }),
        ...ticks(RESTART_GRACE_TICKS, GRACE_TICK_MS),
        Story.message(Message.PressedKey({ code: 'Enter' })),
        throughIntro,
        Story.model(({ phase, seats: [{ player }], stats, zombies }) => {
          expect(Phase.guards.Preparation(phase)).toBe(true)
          expect(player.hp).toBe(PLAYER_MAX_HP)
          expect(scoreOf(stats)).toBe(0)
          expect(zombies).toEqual([])
        }),
      )
    },
  )
})

describe('game events', () => {
  it.effect(
    'a frame records what happened in it and the next frame clears them',
    () => {
      const shot = { x: START_LEVEL.start.x + 6, y: START_LEVEL.start.y }
      const zombieX = MUZZLE_X

      return Story.story(
        APPLICATION,
        Story.given(
          withZombies(playingModel, [
            modifyFields(
              zombieAt(100, zombieX, START_LEVEL.start.y, { speed: 0 }),
              {
                hp: () => 1,
              },
            ),
          ]),
        ),
        holdFire,
        tick(FRAME_MS),
        releaseFire,
        Story.model(({ frameEvents }) => {
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
        Story.model(({ frameEvents }) => {
          expect(frameEvents).toEqual([])
        }),
      )
    },
  )

  it.effect('a contact frame records PlayerHurt once', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withZombies(playingModel, [
          zombieAt(100, START_LEVEL.start.x + 2, START_LEVEL.start.y, {
            speed: 0,
          }),
        ]),
      ),
      tick(FRAME_MS),
      Story.model(({ frameEvents }) => {
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
      Story.model(({ frameEvents }) => {
        expect(frameEvents).toEqual([])
      }),
    ),
  )
})

describe('determinism', () => {
  const playSession = (seed: number) =>
    Story.story(
      APPLICATION,
      Story.given(modifyFields(readyModel, { rngState: () => seed })),
      Story.message(Message.PressedKey({ code: 'Enter' })),
      resolveFocusLobby(),
      Story.message(Message.PressedKey({ code: 'Enter' })),
      Story.message(Message.ReleasedKey({ code: 'Enter' })),
      throughIntro,
      Story.message(Message.PressedKey({ code: 'Enter' })),
      holdFire,
      Story.message(Message.PressedKey({ code: 'KeyW' })),
      ...ticks(120, 16),
      Story.message(Message.ReleasedKey({ code: 'KeyW' })),
      Story.message(Message.PressedKey({ code: 'KeyA' })),
      ...ticks(120, 33),
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
