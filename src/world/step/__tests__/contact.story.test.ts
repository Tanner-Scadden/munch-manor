import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import {
  Frenzy,
  GameEvent,
  Invulnerability,
  type Model,
  Phase,
  type Zombie,
  ZombieAction,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import {
  CONTACT_ALLOWANCE_PX,
  FIXED_STEP_MS,
  PLAYER_RADIUS,
} from '../../../shared/constants'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import {
  APPLICATION,
  holdFire,
  holdingSecond,
  ticks,
  zombieOf,
} from '../../../test/testing'
import { WEAPONS } from '../../gear/weapons'
import { focusOf, modifyFocus } from '../../party/party'
import { ZOMBIE_KINDS, bodyRadiusOf } from '../../zombies/zombies'

const FRAME_MS = FIXED_STEP_MS
const LONG_FRAME_MS = 50
// NOTE: on the open floor between the dining room's table and the start
// spot, clear of the table and the candelabras on every side.
const PLAYER_X = 180
const PLAYER_Y = 130
const EPSILON = 1e-6

const fightingBase: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
  phase: () => Phase.Wave({ wave: 1, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
})

const STEADFAST = Invulnerability.Invulnerable({
  remainingMs: 1e9,
  durationMs: 1e9,
})

const sceneOf = (
  zombies: ReadonlyArray<Zombie>,
  { isSteadfast = false }: Readonly<{ isSteadfast?: boolean }> = {},
): Model =>
  modifyFocus(modifyFields(fightingBase, { zombies: () => zombies }), {
    player: player =>
      modifyFields(player, {
        x: () => PLAYER_X,
        y: () => PLAYER_Y,
        facing: () => ({ x: 1, y: 0 }),
        hp: hp => hp + 50,
        invulnerability: invulnerability =>
          isSteadfast ? STEADFAST : invulnerability,
      }),
  })

const contactOf = (zombie: Zombie): number =>
  bodyRadiusOf(zombie) + PLAYER_RADIUS - CONTACT_ALLOWANCE_PX

const gapOf = (current: Model, zombie: Zombie): number =>
  Math.hypot(
    zombie.x - focusOf(current).player.x,
    zombie.y - focusOf(current).player.y,
  ) - contactOf(zombie)

// NOTE: the smallest gap any free zombie left to its contact distance over
// every frame. Below zero means a zombie stood deeper inside the player than
// the allowance.
const closestGap = (frames: ReadonlyArray<Model>): number =>
  Array.reduce(frames, Infinity, (closest, frame) =>
    Array.reduce(frame.zombies, closest, (inner, zombie) =>
      Math.min(inner, gapOf(frame, zombie)),
    ),
  )

const playFrames = (
  start: Model,
  count: number,
  deltaTime: number,
  before: ReadonlyArray<typeof holdFire> = [],
): Effect.Effect<ReadonlyArray<Model>> =>
  Effect.suspend(() => {
    const frames: Array<Model> = []
    return Story.story(
      APPLICATION,
      Story.given(start),
      ...before,
      ...Array.flatMap(ticks(count, deltaTime), frame => [
        frame,
        Story.model((current: Model) => {
          frames.push(current)
        }),
      ]),
    ).pipe(Effect.as<ReadonlyArray<Model>>(frames))
  })

const runnerMaxSpeed = ZOMBIE_KINDS.Runner.speedMax

describe('zombies stop at the player', () => {
  it.effect(
    'a Hotfoot charging at full speed stops at the player instead of standing on them',
    () =>
      Effect.gen(function* () {
        const runner = zombieOf('Runner', 1, PLAYER_X - 60, PLAYER_Y, {
          speed: runnerMaxSpeed,
        })
        const frames = yield* playFrames(sceneOf([runner]), 150, FRAME_MS)

        expect(
          Array.some(frames, frame =>
            Array.some(frame.zombies, zombie => gapOf(frame, zombie) < 1),
          ),
        ).toBe(true)
        expect(closestGap(frames)).toBeGreaterThanOrEqual(-EPSILON)
      }),
  )

  it.effect(
    'a frenzied Hotfoot on long frames never ends a frame past the allowance',
    () =>
      Effect.gen(function* () {
        const runner = zombieOf('Runner', 1, PLAYER_X - 40, PLAYER_Y + 3, {
          speed: runnerMaxSpeed,
          frenzy: Frenzy.Frenzied({ pack: 1, apartMs: 0 }),
        })
        const frames = yield* playFrames(
          sceneOf([runner], { isSteadfast: true }),
          60,
          LONG_FRAME_MS,
        )

        expect(closestGap(frames)).toBeGreaterThanOrEqual(-EPSILON)
      }),
  )

  it.effect('a crowd pushing from behind does not stack onto the player', () =>
    Effect.gen(function* () {
      const crowd = Array.makeBy(8, index =>
        zombieOf(
          index % 2 === 0 ? 'Runner' : 'Shambler',
          index + 1,
          PLAYER_X - 20 - (index % 4) * 7,
          PLAYER_Y - 6 + Math.floor(index / 4) * 12,
          {
            speed: index % 2 === 0 ? runnerMaxSpeed : 20,
          },
        ),
      )
      const frames = yield* playFrames(
        sceneOf(crowd, { isSteadfast: true }),
        200,
        FRAME_MS,
      )

      expect(closestGap(frames)).toBeGreaterThanOrEqual(-EPSILON)
    }),
  )

  it.effect('a bite still lands and still bumps the Hotfoot back', () =>
    Effect.gen(function* () {
      const runner = zombieOf('Runner', 1, PLAYER_X - 30, PLAYER_Y, {
        speed: runnerMaxSpeed,
      })
      const frames = yield* playFrames(sceneOf([runner]), 60, FRAME_MS)
      const bitten = Array.findFirstIndex(frames, frame =>
        Array.some(frame.frameEvents, GameEvent.guards.PlayerHurt),
      )

      expect(Option.isSome(bitten)).toBe(true)
      const biteFrame = Option.getOrElse(bitten, () => 0)
      const knockback = frames[biteFrame]?.zombies[0]?.knockback.x ?? 0
      expect(knockback).toBeLessThan(0)
    }),
  )
})

describe('point-blank shots', () => {
  it.effect('a pistol shot kills a zombie standing on the player', () =>
    Effect.gen(function* () {
      const dazed = modifyFields(
        zombieOf('Shambler', 1, PLAYER_X - 1, PLAYER_Y, { hp: 1 }),
        {
          action: () =>
            ZombieAction.Dazed({ remainingMs: 1e9, durationMs: 1e9 }),
        },
      )
      const frames = yield* playFrames(
        sceneOf([dazed], { isSteadfast: true }),
        10,
        FRAME_MS,
        [holdFire],
      )

      expect(
        Array.some(frames, frame =>
          Array.some(frame.frameEvents, GameEvent.guards.ZombieKilled),
        ),
      ).toBe(true)
    }),
  )

  it.effect(
    'every Barn Buster pellet hits a zombie on the player and knocks it away',
    () =>
      Effect.gen(function* () {
        const dazed = modifyFields(
          zombieOf('Shambler', 1, PLAYER_X, PLAYER_Y, { hp: 50 }),
          {
            action: () =>
              ZombieAction.Dazed({ remainingMs: 1e9, durationMs: 1e9 }),
          },
        )
        const start = modifyFocus(sceneOf([dazed], { isSteadfast: true }), {
          player: player =>
            modifyFields(player, {
              arsenal: () =>
                holdingSecond({
                  kind: 'Shotgun',
                  rounds: 16,
                  loaded: 6,
                  tier: 0,
                }),
            }),
        })
        const frames = yield* playFrames(start, 1, FRAME_MS, [holdFire])
        const shot = frames[0]?.zombies[0]

        expect(shot?.hp).toBe(
          50 - WEAPONS.Shotgun.pellets * WEAPONS.Shotgun.damage,
        )
        expect(shot?.knockback.x ?? 0).toBeGreaterThan(0)
      }),
  )
})
