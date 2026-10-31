import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR } from './arena'
import {
  FIRE_INTERVAL_MS,
  FIXED_STEP_MS,
  HIT_STOP_HURT_MS,
  PLAYER_INVULNERABLE_MS,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  SCORE_PER_ZOMBIE,
  SHAMBLER_BOUNTY,
  ZOMBIE_DYING_MS,
  ZOMBIE_HIT_PULSE_MS,
  ZOMBIE_KNOCKBACK_SPEED,
  ZOMBIE_MAX_HP,
} from './constants'
import { update } from './main'
import { Message } from './message'
import {
  GameEvent,
  Invulnerability,
  type Model,
  Phase,
  type Zombie,
  ZombieState,
} from './model'
import {
  NORMAL_BITE_GRACE,
  playingModel,
  readyModel,
  withZombies,
} from './model.fixture'
import { scoreOf } from './stats'
import {
  FRAME_MS,
  MUZZLE_X,
  RESTART_GRACE_TICKS,
  holdFire,
  releaseFire,
  scoring,
  tick,
  ticks,
  waitOutFreeze,
  zombieAt,
} from './testing'

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
  test('moves the player by speed times the tick', () => {
    story(
      update,
      given(playingModel),
      message(Message.PressedKey({ code: 'KeyD' })),
      tick(FRAME_MS),
      model(({ player }) => {
        expect(player.x).toBeCloseTo(
          PARLOUR.width / 2 + (PLAYER_SPEED * FRAME_MS) / 1000,
        )
        expect(player.y).toBe(PARLOUR.height / 2)
      }),
    )
  })

  test('clamps a stalled frame delta to 50 ms', () => {
    story(
      update,
      given(playingModel),
      message(Message.PressedKey({ code: 'KeyA' })),
      tick(5000),
      model(({ player, elapsedMs }) => {
        expect(player.x).toBeCloseTo(PARLOUR.width / 2 - PLAYER_SPEED * 0.05)
        expect(elapsedMs).toBe(50)
      }),
    )
  })

  test('ignores frames while the game is not playing', () => {
    story(
      update,
      given(readyModel),
      message(Message.PressedKey({ code: 'KeyD' })),
      tick(FIXED_STEP_MS),
      model(nextModel => {
        expect(nextModel.player.x).toBe(PARLOUR.width / 2)
        expect(nextModel.elapsedMs).toBe(0)
      }),
    )
  })
})

describe('keyboard intent', () => {
  test('combines held keys into a normalized movement vector', () => {
    story(
      update,
      given(playingModel),
      message(Message.PressedKey({ code: 'KeyW' })),
      message(Message.PressedKey({ code: 'KeyD' })),
      model(({ intent }) => {
        expect(intent.move.x).toBeCloseTo(Math.SQRT1_2)
        expect(intent.move.y).toBeCloseTo(-Math.SQRT1_2)
      }),
      message(Message.ReleasedKey({ code: 'KeyW' })),
      model(({ intent }) => {
        expect(intent.move).toEqual({ x: 1, y: 0 })
      }),
    )
  })

  test('window blur releases every held key and the trigger', () => {
    story(
      update,
      given(playingModel),
      message(Message.PressedKey({ code: 'KeyS' })),
      holdFire,
      model(({ intent }) => {
        expect(intent.move).toEqual({ x: 0, y: 1 })
        expect(intent.trigger).toBe('Held')
      }),
      message(Message.BlurredWindow()),
      model(({ input, intent }) => {
        expect(input.pressedKeys).toEqual([])
        expect(intent.move).toEqual({ x: 0, y: 0 })
        expect(intent.trigger).toBe('Released')
      }),
    )
  })

  test('Enter starts the run in the first preparation', () => {
    story(
      update,
      given(readyModel),
      message(Message.PressedKey({ code: 'Enter' })),
      model(({ phase }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
      }),
    )
  })
})

describe('firing', () => {
  test('fires at most once per fire interval while the trigger is held', () => {
    const frameMs = FIRE_INTERVAL_MS / 5

    story(
      update,
      given(playingModel),
      holdFire,
      tick(frameMs),
      model(({ stats }) => {
        expect(stats.shotsFired).toBe(1)
      }),
      ...ticks(4, frameMs),
      model(({ stats }) => {
        expect(stats.shotsFired).toBe(1)
      }),
      tick(frameMs),
      model(({ stats }) => {
        expect(stats.shotsFired).toBe(2)
      }),
      ...ticks(5, frameMs),
      model(({ stats }) => {
        expect(stats.shotsFired).toBe(3)
      }),
    )
  })

  test('does not fire while the trigger is released', () => {
    story(
      update,
      given(playingModel),
      ...ticks(10, 16),
      model(({ bullets }) => {
        expect(bullets).toEqual([])
      }),
    )
  })

  test('bullets expire when they leave the arena', () => {
    story(
      update,
      given(playingModel),
      holdFire,
      tick(FIXED_STEP_MS),
      releaseFire,
      ...ticks(20, 50),
      model(({ bullets }) => {
        expect(bullets).toEqual([])
      }),
    )
  })
})

describe('zombies', () => {
  test('chase a nearby player in a straight line', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, 100, PARLOUR.height / 2, { speed: 20 }),
        ]),
      ),
      tick(50),
      model(({ zombies }) => {
        expect(
          Array.map(zombies, zombie => modifyFields(zombie, { x: () => 0 })),
        ).toEqual([zombieAt(100, 0, PARLOUR.height / 2, { speed: 20 })])
        expect(zombies[0]?.x).toBeCloseTo(101, 9)
      }),
    )
  })

  test('a zombie takes its health in pistol hits to die and scores on the kill', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, MUZZLE_X, PARLOUR.height / 2, { speed: 0 }),
          zombieAt(101, 20, 20, { speed: 0 }),
        ]),
      ),
      holdFire,
      tick(FRAME_MS),
      model(({ bullets, zombies, stats }) => {
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
      model(({ zombies, stats }) => {
        const struck = Option.getOrThrow(Array.head(zombies))
        expect(struck.hp).toBe(0)
        expect(ZombieState.guards.Dying(struck.state)).toBe(true)
        expect(scoreOf(stats)).toBe(SCORE_PER_ZOMBIE)
      }),
    )
  })

  test('a hit flashes and knocks the zombie back along the bullet, then both decay', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, MUZZLE_X, PARLOUR.height / 2, { speed: 0 }),
        ]),
      ),
      holdFire,
      tick(FRAME_MS),
      releaseFire,
      model(({ zombies }) => {
        expect(zombies).toEqual([
          modifyFields(
            zombieAt(100, MUZZLE_X, PARLOUR.height / 2, { speed: 0 }),
            {
              hp: () => ZOMBIE_MAX_HP - 1,
              knockback: () => ({ x: ZOMBIE_KNOCKBACK_SPEED, y: 0 }),
              hitRemainingMs: () => ZOMBIE_HIT_PULSE_MS,
            },
          ),
        ])
      }),
      tick(FRAME_MS),
      model(({ zombies }) => {
        const zombie = Option.getOrThrow(Array.head(zombies))
        expect(zombie.x).toBeGreaterThan(MUZZLE_X)
        expect(zombie.knockback.x).toBeGreaterThan(0)
        expect(zombie.knockback.x).toBeLessThan(ZOMBIE_KNOCKBACK_SPEED)
        expect(zombie.hitRemainingMs).toBe(ZOMBIE_HIT_PULSE_MS - FRAME_MS)
      }),
      ...ticks(30, FRAME_MS),
      model(({ zombies }) => {
        const zombie = Option.getOrThrow(Array.head(zombies))
        expect(zombie.knockback).toEqual({ x: 0, y: 0 })
        expect(zombie.hitRemainingMs).toBe(0)
      }),
    )
  })

  test('a dying zombie does not hurt the player and is removed when its animation ends', () => {
    const frameCount = Math.ceil(ZOMBIE_DYING_MS / FRAME_MS)

    story(
      update,
      given(
        withZombies(playingModel, [
          dyingZombieAt(100, PARLOUR.width / 2 + 2, PARLOUR.height / 2),
        ]),
      ),
      ...ticks(frameCount - 1, FRAME_MS),
      model(({ zombies, player }) => {
        expect(Array.map(zombies, ({ id }) => id)).toEqual([100])
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(player.invulnerability).toEqual(Invulnerability.Vulnerable())
      }),
      tick(FRAME_MS),
      model(({ zombies, player }) => {
        expect(zombies).toEqual([])
        expect(player.hp).toBe(PLAYER_MAX_HP)
      }),
    )
  })

  test('bullets pass through a dying zombie', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          dyingZombieAt(100, MUZZLE_X, PARLOUR.height / 2),
        ]),
      ),
      holdFire,
      tick(FRAME_MS),
      model(({ bullets, stats }) => {
        expect(bullets).toHaveLength(1)
        expect(scoreOf(stats)).toBe(0)
      }),
    )
  })

  test('a zombie that reaches the player costs one heart, knocks the player back, and stays', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, PARLOUR.width / 2 + 2, PARLOUR.height / 2, {
            speed: 0,
          }),
        ]),
      ),
      tick(FRAME_MS),
      model(({ zombies, player, phase }) => {
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
      model(({ player }) => {
        expect(player.x).toBeLessThan(PARLOUR.width / 2)
      }),
    )
  })

  test('contact during invulnerability costs nothing, and contact after it ends hurts again', () => {
    const invulnerableTicks = Math.round(
      (PLAYER_INVULNERABLE_MS * NORMAL_BITE_GRACE) / FRAME_MS,
    )

    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, PARLOUR.width / 2 + 2, PARLOUR.height / 2, {
            speed: 60,
          }),
          zombieAt(101, PARLOUR.width / 2 - 2, PARLOUR.height / 2, {
            speed: 60,
          }),
        ]),
      ),
      tick(FRAME_MS),
      model(({ player }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP - 1)
      }),
      ...waitOutFreeze(HIT_STOP_HURT_MS),
      ...ticks(invulnerableTicks - 1, FRAME_MS),
      model(({ player }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP - 1)
        expect(
          Invulnerability.guards.Invulnerable(player.invulnerability),
        ).toBe(true)
      }),
      ...ticks(2, FRAME_MS),
      model(({ player }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP - 2)
      }),
    )
  })

  test('the game ends when HP reaches zero, and Enter starts a fresh run', () => {
    const lastHeartModel = withZombies(
      modifyFields(playingModel, {
        player: player => modifyFields(player, { hp: () => 1 }),
        stats: scoring(120),
      }),
      [
        zombieAt(100, PARLOUR.width / 2, PARLOUR.height / 2 + 3, {
          speed: 20,
        }),
      ],
    )

    story(
      update,
      given(lastHeartModel),
      tick(FRAME_MS),
      model(({ phase, player, stats }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: 1 }))
        expect(player.hp).toBe(0)
        expect(scoreOf(stats)).toBe(120)
      }),
      tick(FRAME_MS),
      model(({ elapsedMs }) => {
        expect(elapsedMs).toBe(FRAME_MS)
      }),
      ...ticks(RESTART_GRACE_TICKS, GRACE_TICK_MS),
      message(Message.PressedKey({ code: 'Enter' })),
      model(({ phase, player, stats, zombies }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(scoreOf(stats)).toBe(0)
        expect(zombies).toEqual([])
      }),
    )
  })
})

describe('game events', () => {
  test('a frame records what happened in it and the next frame clears them', () => {
    const shot = { x: PARLOUR.width / 2 + 6, y: PARLOUR.height / 2 }
    const zombieX = MUZZLE_X

    story(
      update,
      given(
        withZombies(playingModel, [
          modifyFields(
            zombieAt(100, zombieX, PARLOUR.height / 2, { speed: 0 }),
            {
              hp: () => 1,
            },
          ),
        ]),
      ),
      holdFire,
      tick(FRAME_MS),
      releaseFire,
      model(({ frameEvents }) => {
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
              y: PARLOUR.height / 2,
              direction: RIGHT,
              bounty: SHAMBLER_BOUNTY,
              kind: 'Shambler',
            }),
          ),
        )
      }),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(frameEvents).toEqual([])
      }),
    )
  })

  test('a contact frame records PlayerHurt once', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, PARLOUR.width / 2 + 2, PARLOUR.height / 2, {
            speed: 0,
          }),
        ]),
      ),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(frameEvents).toEqual([
          GameEvent.PlayerHurt({
            x: PARLOUR.width / 2,
            y: PARLOUR.height / 2,
            direction: { x: -1, y: 0 },
            source: 'Shambler',
          }),
        ])
      }),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(frameEvents).toEqual([])
      }),
    )
  })
})

describe('determinism', () => {
  const playSession = (seed: number): Model => {
    const sessions: Array<Model> = []
    story(
      update,
      given(modifyFields(readyModel, { rngState: () => seed })),
      message(Message.PressedKey({ code: 'Enter' })),
      message(Message.ReleasedKey({ code: 'Enter' })),
      message(Message.PressedKey({ code: 'Enter' })),
      holdFire,
      message(Message.PressedKey({ code: 'KeyW' })),
      ...ticks(120, 16),
      message(Message.ReleasedKey({ code: 'KeyW' })),
      message(Message.PressedKey({ code: 'KeyA' })),
      ...ticks(120, 33),
      model(finalModel => {
        sessions.push(finalModel)
      }),
    )
    return Option.getOrThrow(Array.head(sessions))
  }

  test('the same seed and Messages produce the same Model', () => {
    const first = playSession(1234)
    const second = playSession(1234)

    expect(first.zombies.length + scoreOf(first.stats)).toBeGreaterThan(0)
    expect(second).toEqual(first)
  })

  test('a different seed produces a different game', () => {
    expect(playSession(1234).zombies).not.toEqual(playSession(98765).zombies)
  })
})
