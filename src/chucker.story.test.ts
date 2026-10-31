import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR } from './arena'
import { CHUCKER_RULES } from './chucker'
import { FIXED_STEP_MS, HIT_STOP_HURT_MS, PLAYER_MAX_HP } from './constants'
import { update } from './main'
import { debutPitch } from './menus'
import { Message } from './message'
import {
  type Bullet,
  type Model,
  Phase,
  Pierce,
  type Zombie,
  ZombieAction,
  ZombieState,
  initialModel,
} from './model'
import { DISTANT_SPAWN } from './model.fixture'
import {
  bulletInto,
  hasEvent,
  tick,
  ticks,
  zombieById,
  zombieOf,
} from './testing'
import { ZOMBIE_KINDS } from './zombies'

const FRAME_MS = FIXED_STEP_MS
const CENTER_X = PARLOUR.width / 2
const CENTER_Y = PARLOUR.height / 2
const CHUCKER_ID = 10
const GROANER_ID = 11

// NOTE: how many ticks a countdown of `ms` takes to run out. The float sum
// of 1000/60 ms ticks can leave a hair of a whole number of ticks, so this
// counts down the way the game does instead of dividing.
const framesFor = (ms: number, count = 0): number =>
  ms > 0 ? framesFor(ms - FRAME_MS, count + 1) : count

const CHUCKER = zombieOf('Thrower', CHUCKER_ID, CENTER_X + 60, CENTER_Y, {
  hp: 8,
})
const GROANER = zombieOf('Shambler', GROANER_ID, CENTER_X + 52, CENTER_Y, {
  hp: 3,
})

const sceneWith = (zombies: ReadonlyArray<Zombie>): Model =>
  modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () => Phase.Wave({ wave: 6, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    zombies: () => zombies,
  })

const HEFT_FRAMES = framesFor(CHUCKER_RULES.heftMs)
const FLIGHT_FRAMES = framesFor(CHUCKER_RULES.flightMs)

describe('the Big Leaguer', () => {
  test('grabs a Groaner beside it, winds up with it overhead, and lobs it at the player', () => {
    story(
      update,
      given(sceneWith([CHUCKER, GROANER])),
      tick(FRAME_MS),
      model(current => {
        expect(hasEvent(current, 'ZombieGrabbed')).toBe(true)
        expect(zombieById(current, CHUCKER_ID).action).toEqual(
          ZombieAction.Hefting({
            victimId: GROANER_ID,
            remainingMs: CHUCKER_RULES.heftMs,
            durationMs: CHUCKER_RULES.heftMs,
          }),
        )
        expect(zombieById(current, GROANER_ID).action).toEqual(
          ZombieAction.Carried({ byId: CHUCKER_ID }),
        )
      }),
      ...ticks(HEFT_FRAMES - 2, FRAME_MS),
      model(current => {
        expect(
          ZombieAction.isAnyOf(['Hefting'])(
            zombieById(current, CHUCKER_ID).action,
          ),
        ).toBe(true)
        const carried = zombieById(current, GROANER_ID)
        expect(ZombieAction.isAnyOf(['Carried'])(carried.action)).toBe(true)
        expect(carried.x).toBe(zombieById(current, CHUCKER_ID).x)
      }),
      ...ticks(2, FRAME_MS),
      model(current => {
        expect(hasEvent(current, 'ZombieThrown')).toBe(true)
        expect(
          ZombieAction.isAnyOf(['Winded'])(
            zombieById(current, CHUCKER_ID).action,
          ),
        ).toBe(true)
        const chucker = zombieById(current, CHUCKER_ID)
        expect(zombieById(current, GROANER_ID).action).toMatchObject({
          _tag: 'Flying',
          to: { x: current.player.x, y: current.player.y },
          from: { x: chucker.x, y: chucker.y },
          durationMs: CHUCKER_RULES.flightMs,
        })
      }),
    )
  })

  test('the thrown Groaner hurts the player on its mark, lies dazed for a second, then gets up', () => {
    story(
      update,
      given(sceneWith([CHUCKER, GROANER])),
      ...ticks(HEFT_FRAMES + 1, FRAME_MS),
      model(current => {
        expect(current.player.hp).toBe(PLAYER_MAX_HP)
      }),
      ...ticks(FLIGHT_FRAMES - 2, FRAME_MS),
      model(current => {
        expect(current.player.hp).toBe(PLAYER_MAX_HP)
        expect(
          ZombieAction.isAnyOf(['Flying'])(
            zombieById(current, GROANER_ID).action,
          ),
        ).toBe(true)
      }),
      tick(FRAME_MS),
      model(current => {
        expect(hasEvent(current, 'ZombieLanded')).toBe(true)
        expect(current.player.hp).toBe(PLAYER_MAX_HP - CHUCKER_RULES.landDamage)
        const landed = zombieById(current, GROANER_ID)
        expect(ZombieAction.isAnyOf(['Dazed'])(landed.action)).toBe(true)
        expect(
          Math.hypot(landed.x - current.player.x, landed.y - current.player.y),
        ).toBeLessThan(CHUCKER_RULES.landRadius + 8)
      }),
      ...ticks(framesFor(CHUCKER_RULES.dazedMs) - 1, FRAME_MS),
      model(current => {
        expect(
          ZombieAction.isAnyOf(['Dazed'])(
            zombieById(current, GROANER_ID).action,
          ),
        ).toBe(true)
      }),
      ...ticks(framesFor(HIT_STOP_HURT_MS) + 2, FRAME_MS),
      model(current => {
        expect(zombieById(current, GROANER_ID).action).toEqual(
          ZombieAction.Roaming(),
        )
      }),
    )
  })

  test('a player who steps off the mark is not hurt by the landing', () => {
    story(
      update,
      given(sceneWith([CHUCKER, GROANER])),
      ...ticks(HEFT_FRAMES + 1, FRAME_MS),
      message(Message.PressedKey({ code: 'KeyW' })),
      ...ticks(FLIGHT_FRAMES, FRAME_MS),
      model(current => {
        expect(current.player.hp).toBe(PLAYER_MAX_HP)
        expect(
          ZombieAction.isAnyOf(['Dazed'])(
            zombieById(current, GROANER_ID).action,
          ),
        ).toBe(true)
      }),
    )
  })

  test('a Big Leaguer shot down mid-heave drops its Groaner, dazed', () => {
    const midHeave = sceneWith([
      modifyFields(CHUCKER, {
        action: () =>
          ZombieAction.Hefting({
            victimId: GROANER_ID,
            remainingMs: 500,
            durationMs: CHUCKER_RULES.heftMs,
          }),
      }),
      modifyFields(GROANER, {
        x: () => CHUCKER.x,
        action: () => ZombieAction.Carried({ byId: CHUCKER_ID }),
      }),
    ])
    story(
      update,
      given(
        modifyFields(midHeave, {
          bullets: () => [
            bulletInto(900, CHUCKER, { damage: 20, knockback: 0 }),
          ],
        }),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(
          ZombieState.isAnyOf(['Dying'])(zombieById(current, CHUCKER_ID).state),
        ).toBe(true)
        expect(
          ZombieAction.isAnyOf(['Dazed'])(
            zombieById(current, GROANER_ID).action,
          ),
        ).toBe(true)
        expect(hasEvent(current, 'ZombieThrown')).toBe(false)
      }),
    )
  })

  test('with no Groaner to throw it walks in like any other zombie', () => {
    const far = modifyFields(CHUCKER, {
      x: () => CENTER_X + 100,
      speed: () => 20,
    })
    story(
      update,
      given(sceneWith([far])),
      ...ticks(30, FRAME_MS),
      model(current => {
        expect(zombieById(current, CHUCKER_ID).x).toBeLessThan(far.x - 4)
        expect(
          ZombieAction.isAnyOf(['Roaming'])(
            zombieById(current, CHUCKER_ID).action,
          ),
        ).toBe(true)
      }),
    )
  })
})

const LEAGUER_ID = 20
const HELD_ID = 21
const PLAYER_AT = { x: CENTER_X, y: CENTER_Y }
const FACING_PLAYER = Math.PI

const atPlayer = (scene: Model): Model =>
  modifyFields(scene, {
    player: player =>
      modifyFields(player, { x: () => PLAYER_AT.x, y: () => PLAYER_AT.y }),
  })

const LEAGUER_HP = ZOMBIE_KINDS.Thrower.hp

const leaguerAt = (x: number, y = CENTER_Y): Zombie =>
  zombieOf('Thrower', LEAGUER_ID, x, y, { hp: LEAGUER_HP })

const shielding = (x: number, heldHp = 3): ReadonlyArray<Zombie> => [
  {
    ...leaguerAt(x),
    action: ZombieAction.Shielding({
      victimId: HELD_ID,
      remainingMs: CHUCKER_RULES.shieldMs,
      aim: FACING_PLAYER,
    }),
  },
  {
    ...zombieOf('Shambler', HELD_ID, x - CHUCKER_RULES.shieldHoldPx, CENTER_Y, {
      hp: heldHp,
    }),
    action: ZombieAction.Shielded({ byId: LEAGUER_ID }),
  },
]

const shotInto = (
  id: number,
  zombie: Zombie,
  velocity: Readonly<{ x: number; y: number }>,
  pierce: Pierce = Pierce.Stops(),
): Bullet => ({
  ...bulletInto(id, zombie, { damage: 2, knockback: 0 }),
  velocityX: velocity.x,
  velocityY: velocity.y,
  pierce,
})

const withBullets = (scene: Model, bullets: ReadonlyArray<Bullet>): Model =>
  modifyFields(scene, { bullets: () => bullets })

const isShielding = (zombie: Zombie): boolean =>
  ZombieAction.isAnyOf(['Shielding'])(zombie.action)

describe('the Big Leaguer shield', () => {
  test('he is slower than any Groaner and carries the new name', () => {
    expect(ZOMBIE_KINDS.Thrower.speedMax).toBeLessThanOrEqual(
      ZOMBIE_KINDS.Shambler.speedMin,
    )
    expect(ZOMBIE_KINDS.Thrower.name).toBe('Big Leaguer')
    expect(debutPitch('Thrower')).toBe(
      'He pitches zombies. Get close and he hides behind one.',
    )
  })

  test('crowding him makes him yank the nearest Groaner up as a shield', () => {
    const leaguer = leaguerAt(CENTER_X + 40)
    const runner = zombieOf('Runner', 30, CENTER_X + 44, CENTER_Y, { hp: 2 })
    const groaner = zombieOf('Shambler', HELD_ID, CENTER_X + 52, CENTER_Y, {
      hp: 3,
    })
    story(
      update,
      given(atPlayer(sceneWith([leaguer, runner, groaner]))),
      tick(FRAME_MS),
      model(current => {
        expect(hasEvent(current, 'ShieldRaised')).toBe(true)
        const raised = zombieById(current, LEAGUER_ID)
        expect(isShielding(raised)).toBe(true)
        expect(zombieById(current, HELD_ID).action).toEqual(
          ZombieAction.Shielded({ byId: LEAGUER_ID }),
        )
      }),
      tick(FRAME_MS),
      model(current => {
        expect(zombieById(current, HELD_ID).x).toBeLessThan(
          zombieById(current, LEAGUER_ID).x,
        )
      }),
    )
  })

  test('he never grabs a Kaboomer, a Big Lug, or the boss', () => {
    const leaguer = leaguerAt(CENTER_X + 40)
    const others = [
      zombieOf('Exploder', 31, CENTER_X + 44, CENTER_Y, { hp: 6 }),
      zombieOf('Tank', 32, CENTER_X + 46, CENTER_Y + 4, { hp: 30 }),
      zombieOf('Boss', 33, CENTER_X + 48, CENTER_Y - 4, { hp: 90 }),
    ]
    story(
      update,
      given(atPlayer(sceneWith([leaguer, ...others]))),
      ...ticks(3, FRAME_MS),
      model(current => {
        expect(isShielding(zombieById(current, LEAGUER_ID))).toBe(false)
        Array.forEach(others, other =>
          expect(zombieById(current, other.id).action).toEqual(
            ZombieAction.Roaming(),
          ),
        )
      }),
    )
  })

  test('taking a hit from afar makes him raise a shield too', () => {
    const leaguer = leaguerAt(CENTER_X + 110)
    const runner = zombieOf('Runner', 30, CENTER_X + 116, CENTER_Y, { hp: 2 })
    story(
      update,
      given(
        withBullets(atPlayer(sceneWith([leaguer, runner])), [
          shotInto(5, leaguer, { x: 0, y: 1 }),
        ]),
      ),
      ...ticks(2, FRAME_MS),
      model(current => {
        expect(zombieById(current, LEAGUER_ID).hp).toBeLessThan(LEAGUER_HP)
        expect(zombieById(current, LEAGUER_ID).action).toEqual(
          expect.objectContaining({ _tag: 'Shielding', victimId: 30 }),
        )
      }),
    )
  })

  test('a shot from the front hits the zombie he holds instead of him', () => {
    const [leaguer, held] = shielding(CENTER_X + 40)
    story(
      update,
      given(
        withBullets(atPlayer(sceneWith([leaguer!, held!])), [
          shotInto(5, leaguer!, { x: 1, y: 0 }),
        ]),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(zombieById(current, LEAGUER_ID).hp).toBe(LEAGUER_HP)
        expect(zombieById(current, HELD_ID).hp).toBe(1)
      }),
    )
  })

  test('shots from the side or behind, and piercing shots, reach him', () => {
    const [leaguer, held] = shielding(CENTER_X + 40)
    const shots = [
      shotInto(5, leaguer!, { x: 0, y: 1 }),
      shotInto(6, leaguer!, { x: -1, y: 0 }),
      shotInto(
        7,
        leaguer!,
        { x: 1, y: 0 },
        Pierce.Skewers({ left: 1, struck: [] }),
      ),
    ]
    Array.forEach(shots, shot =>
      story(
        update,
        given(withBullets(atPlayer(sceneWith([leaguer!, held!])), [shot])),
        tick(FRAME_MS),
        model(current => {
          expect(zombieById(current, LEAGUER_ID).hp).toBe(LEAGUER_HP - 2)
          expect(zombieById(current, HELD_ID).hp).toBe(3)
        }),
      ),
    )
  })

  test('a Kaboomer burst is not blocked by the shield', () => {
    const [leaguer, held] = shielding(CENTER_X + 40)
    const bomber: Zombie = {
      ...zombieOf('Exploder', 40, CENTER_X + 30, CENTER_Y, { hp: 6 }),
      hp: 0,
      state: ZombieState.Fusing({ remainingMs: 0 }),
    }
    story(
      update,
      given(atPlayer(sceneWith([leaguer!, held!, bomber]))),
      tick(FRAME_MS),
      model(current => {
        expect(hasEvent(current, 'Exploded')).toBe(true)
        expect(zombieById(current, LEAGUER_ID).hp).toBeLessThan(LEAGUER_HP)
        expect(zombieById(current, HELD_ID).hp).toBe(3)
      }),
    )
  })

  test('he cannot throw while he holds a shield', () => {
    const [leaguer, held] = shielding(CENTER_X + 40)
    const spare = zombieOf('Shambler', 50, CENTER_X + 46, CENTER_Y + 4, {
      hp: 3,
    })
    const frames: Array<boolean> = []
    story(
      update,
      given(atPlayer(sceneWith([leaguer!, held!, spare]))),
      ...Array.flatMap(
        Array.makeBy(framesFor(CHUCKER_RULES.shieldMs) - 2, () => 0),
        () => [
          tick(FRAME_MS),
          model((current: Model) => {
            frames.push(
              ZombieAction.isAnyOf(['Hefting'])(
                zombieById(current, LEAGUER_ID).action,
              ) || hasEvent(current, 'ZombieThrown'),
            )
          }),
        ],
      ),
    )
    expect(frames).not.toContain(true)
  })

  test('the shield drops when the held zombie dies, then he cools down before the next', () => {
    const [leaguer, held] = shielding(CENTER_X + 40, 2)
    const spare = zombieOf('Runner', 50, CENTER_X + 46, CENTER_Y + 6, { hp: 2 })
    story(
      update,
      given(
        withBullets(atPlayer(sceneWith([leaguer!, held!, spare])), [
          shotInto(5, leaguer!, { x: 1, y: 0 }),
        ]),
      ),
      ...ticks(2, FRAME_MS),
      model(current => {
        expect(zombieById(current, LEAGUER_ID).action).toEqual(
          expect.objectContaining({ _tag: 'Winded' }),
        )
      }),
      ...ticks(framesFor(CHUCKER_RULES.shieldCooldownMs) - 4, FRAME_MS),
      model(current => {
        expect(isShielding(zombieById(current, LEAGUER_ID))).toBe(false)
      }),
      ...ticks(6, FRAME_MS),
      model(current => {
        expect(zombieById(current, LEAGUER_ID).action).toEqual(
          expect.objectContaining({ _tag: 'Shielding', victimId: 50 }),
        )
      }),
    )
  })

  test('the shield drops after its time is up and the held zombie stumbles off dazed', () => {
    const [leaguer, held] = shielding(CENTER_X + 40)
    story(
      update,
      given(atPlayer(sceneWith([leaguer!, held!]))),
      ...ticks(framesFor(CHUCKER_RULES.shieldMs) - 2, FRAME_MS),
      model(current => {
        expect(isShielding(zombieById(current, LEAGUER_ID))).toBe(true)
      }),
      ...ticks(3, FRAME_MS),
      model(current => {
        expect(zombieById(current, LEAGUER_ID).action).toEqual(
          expect.objectContaining({ _tag: 'Winded' }),
        )
        expect(zombieById(current, HELD_ID).action).toEqual(
          expect.objectContaining({ _tag: 'Dazed' }),
        )
      }),
    )
  })
})
