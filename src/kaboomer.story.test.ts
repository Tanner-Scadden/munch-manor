import { Array, Option, Result } from 'effect'
import type { Canvas } from 'foldkit'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR } from './arena'
import { FIXED_STEP_MS, HIT_STOP_KILL_MAX_MS } from './constants'
import { rollSpawns } from './endlessWaves'
import { update } from './main'
import { debutPitch } from './menus'
import {
  type Bullet,
  Frenzy,
  GameEvent,
  type Model,
  Phase,
  type Zombie,
  ZombieAction,
  ZombieState,
  initialModel,
} from './model'
import { DISTANT_SPAWN } from './model.fixture'
import { KABOOMER_FUSE_MAX } from './sprites/zombies'
import { bulletInto, tick, ticks } from './testing'
import { wavePreviewLabel } from './wavePreview'
import {
  kaboomerFuseLength,
  kaboomerSparkMs,
  zombieGroundShapes,
} from './zombieView'
import { Behavior, ZOMBIE_KINDS } from './zombies'

const FRAME_MS = FIXED_STEP_MS
const CENTER_X = PARLOUR.width / 2
const CENTER_Y = PARLOUR.height / 2

const BOMBER = Behavior.match(ZOMBIE_KINDS.Exploder.behavior, {
  Brawler: () => undefined,
  Bomber: bomber => bomber,
  Thrower: () => undefined,
  Crawler: () => undefined,
})

const FULL_HP = ZOMBIE_KINDS.Exploder.hp

const kaboomerAt = (
  id: number,
  x: number,
  y: number,
  hp = FULL_HP,
): Zombie => ({
  id,
  kind: 'Exploder',
  x,
  y,
  speed: 0,
  hp,
  maxHp: FULL_HP,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
  action: ZombieAction.Roaming(),
  frenzy: Frenzy.Calm(),
})

const sceneWith = (
  zombies: ReadonlyArray<Zombie>,
  bullets: ReadonlyArray<Bullet> = [],
): Model =>
  modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    zombies: () => zombies,
    bullets: () => bullets,
  })

const blewUp = (current: Model): boolean =>
  Array.some(current.frameEvents, GameEvent.isAnyOf(['Exploded']))

const circleRadii = (shapes: ReadonlyArray<Canvas.Shape>) =>
  Array.filterMap(shapes, shape =>
    shape._tag === 'Circle' ? Result.succeed(shape.radius) : Result.failVoid,
  )

describe('the Kaboomer', () => {
  test('a Kaboomer that reaches the player lights up with its blast ring on the floor before he pops', () => {
    expect(BOMBER?.contactFuseMs).toBe(340)
    const contactMs = BOMBER?.contactFuseMs ?? 0
    const radius = BOMBER?.blastRadius ?? 0
    const touching = kaboomerAt(1, CENTER_X + 6, CENTER_Y)

    story(
      update,
      given(sceneWith([touching])),
      tick(FRAME_MS),
      model(current => {
        const [kaboomer] = current.zombies
        expect(kaboomer?.state).toEqual(
          ZombieState.Fusing({ remainingMs: contactMs }),
        )
        expect(
          circleRadii(zombieGroundShapes(current.zombies, current.elapsedMs)),
        ).toContain(radius)
      }),
      ...ticks(Math.floor(contactMs / FRAME_MS) - 1, FRAME_MS),
      model(current => {
        expect(blewUp(current)).toBe(false)
        expect(current.zombies).toHaveLength(1)
      }),
      ...ticks(2, FRAME_MS),
      model(current => {
        expect(current.zombies).toHaveLength(0)
      }),
    )
  })

  test('a shot Kaboomer pops a fifth of a second later', () => {
    expect(BOMBER?.shotFuseMs).toBe(200)
    const gasbag = kaboomerAt(1, CENTER_X + 60, CENTER_Y, 3)
    const shotMs = BOMBER?.shotFuseMs ?? 0

    story(
      update,
      given(
        sceneWith(
          [gasbag],
          [bulletInto(5, gasbag, { damage: 3, knockback: 0 })],
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(
          ZombieState.isAnyOf(['Fusing'])(
            Option.getOrThrow(Array.head(current.zombies)).state,
          ),
        ).toBe(true)
      }),
      ...ticks(Math.floor(shotMs / FRAME_MS) - 1, FRAME_MS),
      model(current => {
        expect(current.zombies).toHaveLength(1)
      }),
      ...ticks(2 + Math.ceil(HIT_STOP_KILL_MAX_MS / FRAME_MS), FRAME_MS),
      model(current => {
        expect(current.zombies).toHaveLength(0)
      }),
    )
  })

  test('chains still ripple, each caught Kaboomer a chain fuse after the last, whatever his health', () => {
    expect(BOMBER?.chainFuseMs).toBe(150)
    const tough = (BOMBER?.zombieDamage ?? 0) + 4
    const first = kaboomerAt(1, 220, 60, 3)
    const second = { ...kaboomerAt(2, 236, 60, tough), maxHp: tough }
    const blastFrames: Array<number> = []
    const recorded = Array.flatMap(
      Array.makeBy(80, index => index),
      index => [
        tick(FRAME_MS),
        model((current: Model) => {
          if (blewUp(current)) {
            blastFrames.push(index)
          }
        }),
      ],
    )

    story(
      update,
      given(
        sceneWith(
          [first, second],
          [bulletInto(5, first, { damage: 3, knockback: 0 })],
        ),
      ),
      ...recorded,
    )

    expect(blastFrames).toHaveLength(2)
    const [firstBlast, secondBlast] = blastFrames
    expect(
      ((secondBlast ?? 0) - (firstBlast ?? 0)) * FRAME_MS,
    ).toBeGreaterThanOrEqual((BOMBER?.chainFuseMs ?? 0) - FRAME_MS)
  })

  test('his fuse burns shorter in a few steps as he closes in and each time he is shot', () => {
    const player = modifyFields(initialModel.player, {
      x: () => CENTER_X,
      y: () => CENTER_Y,
    })
    const lengths = Array.makeBy(121, distance =>
      kaboomerFuseLength(kaboomerAt(1, CENTER_X + distance, CENTER_Y), player),
    )
    expect(Array.dedupe(lengths).length).toBeLessThanOrEqual(KABOOMER_FUSE_MAX)
    expect(lengths[120]).toBe(KABOOMER_FUSE_MAX)
    expect(lengths[0]).toBe(1)
    Array.forEach(Array.range(1, 120), distance =>
      expect(lengths[distance] ?? 0).toBeGreaterThanOrEqual(
        lengths[distance - 1] ?? 0,
      ),
    )

    const far = kaboomerAt(1, CENTER_X + 120, CENTER_Y)
    const near = kaboomerAt(2, CENTER_X + 20, CENTER_Y)
    const farOnceShot = kaboomerAt(3, CENTER_X + 120, CENTER_Y, FULL_HP - 3)
    const farTwiceShot = kaboomerAt(4, CENTER_X + 120, CENTER_Y, 1)
    expect(kaboomerFuseLength(near, player)).toBeLessThan(
      kaboomerFuseLength(far, player),
    )
    expect(kaboomerFuseLength(farOnceShot, player)).toBeLessThan(
      kaboomerFuseLength(far, player),
    )
    expect(kaboomerFuseLength(farTwiceShot, player)).toBeLessThan(
      kaboomerFuseLength(farOnceShot, player),
    )
    expect(kaboomerSparkMs(near, player)).toBeLessThan(
      kaboomerSparkMs(far, player),
    )
    expect(kaboomerSparkMs(farTwiceShot, player)).toBeLessThan(
      kaboomerSparkMs(far, player),
    )
  })

  test('the debut card and the door preview call him the Kaboomer', () => {
    expect(ZOMBIE_KINDS.Exploder.name).toBe('Kaboomer')
    expect(debutPitch('Exploder')).toBe(
      'He wants a hug. Pop him from far away.',
    )
    const [, spawns] = rollSpawns(7, 4)
    expect(Array.some(spawns, ({ kind }) => kind === 'Exploder')).toBe(true)
    const label = wavePreviewLabel(4, spawns, [], initialModel.boss)
    expect(label).toContain('Kaboomer')
    expect(label).toContain('New this wave: Kaboomer.')
    expect(label).not.toContain('Gasbag')
  })
})
