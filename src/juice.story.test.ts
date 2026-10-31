import { Array, Option, pipe } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR } from './arena'
import {
  BLOOD_PER_HIT,
  BLOOD_PER_KILL,
  DAMAGE_POPUP_LIFETIME_MS,
  DECAL_MAX,
  DUST_INTERVAL_MS,
  HIT_STOP_COOLDOWN_MS,
  HIT_STOP_HURT_MS,
  HIT_STOP_KILL_MAX_MS,
  HIT_STOP_KILL_MS,
  HIT_STOP_MAX_MS,
  KILL_POPUP_LIFETIME_MS,
  MEAT_GIBS_PER_KILL,
  PARTICLE_MAX,
  PISTOL_DAMAGE,
  PLAYER_SPEED,
  POPUP_MAX,
  RESTART_GRACE_MS,
  ROT_GIBS_PER_KILL,
  SCORE_PER_ZOMBIE,
  SHAKE_DECAY_PER_SECOND,
  SHAKE_FIRING_TRAUMA_MAX,
  SHAKE_MAX_PX,
  SHAKE_TRAUMA_HURT,
  SHAKE_TRAUMA_KILL,
  SHAKE_TRAUMA_MAX,
  SHAMBLER_BOUNTY,
  STREAK_WINDOW_MS,
  ZOMBIE_MAX_HP,
} from './constants'
import { update } from './main'
import { Message } from './message'
import {
  type Bullet,
  type Decal,
  GameEvent,
  HitStop,
  type Model,
  type Particle,
  Phase,
  Pierce,
  Streak,
  type Zombie,
  initialModel,
} from './model'
import { playingModel, withZombies } from './model.fixture'
import { scoreOf } from './stats'
import {
  FRAME_MS,
  MUZZLE_X,
  bulletInto,
  freezeTicks,
  holdFire,
  holdingSecond,
  openFloorSpot,
  releaseFire,
  tick,
  ticks,
  waitOutFreeze,
  zombieAt,
} from './testing'

describe('particles and decals', () => {
  const countKind = (
    items: ReadonlyArray<Particle | Decal>,
    kind: string,
  ): number => Array.filter(items, item => item.kind === kind).length

  const landingFrames = ticks(150, FRAME_MS)

  const shotZombieModel = (hp: number): Model =>
    withZombies(playingModel, [
      modifyFields(zombieAt(100, MUZZLE_X, PARLOUR.height / 2, { speed: 0 }), {
        hp: () => hp,
        maxHp: () => Math.max(hp, ZOMBIE_MAX_HP),
      }),
    ])

  const HEALTH_THAT_KEEPS_ITS_PARTS = 6

  test('a hit sprays blood along the bullet and the shot ejects a shell', () => {
    story(
      update,
      given(shotZombieModel(HEALTH_THAT_KEEPS_ITS_PARTS)),
      holdFire,
      tick(FRAME_MS),
      model(({ particles }) => {
        const blood = Array.filter(particles, ({ kind }) => kind === 'Blood')
        expect(blood).toHaveLength(BLOOD_PER_HIT)
        expect(Array.every(blood, ({ velocityX }) => velocityX > 0)).toBe(true)
        expect(countKind(particles, 'Shell')).toBe(1)
        expect(countKind(particles, 'MeatGib')).toBe(0)
      }),
    )
  })

  test('a kill pops red and green gibs upward', () => {
    story(
      update,
      given(shotZombieModel(1)),
      holdFire,
      tick(FRAME_MS),
      model(({ particles }) => {
        expect(countKind(particles, 'MeatGib')).toBe(MEAT_GIBS_PER_KILL)
        expect(countKind(particles, 'RotGib')).toBe(ROT_GIBS_PER_KILL)
        expect(countKind(particles, 'Blood')).toBe(
          BLOOD_PER_HIT + BLOOD_PER_KILL,
        )
        const gibs = Array.filter(
          particles,
          ({ kind }) => kind === 'MeatGib' || kind === 'RotGib',
        )
        expect(Array.every(gibs, ({ velocityZ }) => velocityZ > 0)).toBe(true)
      }),
    )
  })

  test('particles expire and what lands leaves decals on whole pixels', () => {
    story(
      update,
      given(shotZombieModel(1)),
      holdFire,
      tick(FRAME_MS),
      releaseFire,
      model(({ decals }) => {
        expect(decals).toEqual([])
      }),
      ...landingFrames,
      model(({ particles, decals }) => {
        expect(particles).toEqual([])
        expect(countKind(decals, 'Blood')).toBe(BLOOD_PER_HIT + BLOOD_PER_KILL)
        expect(countKind(decals, 'Meat')).toBe(MEAT_GIBS_PER_KILL)
        expect(countKind(decals, 'Rot')).toBe(ROT_GIBS_PER_KILL)
        expect(countKind(decals, 'Shell')).toBe(1)
        expect(
          Array.every(
            decals,
            ({ x, y }) => Number.isInteger(x) && Number.isInteger(y),
          ),
        ).toBe(true)
      }),
    )
  })

  test('walking kicks up a dust puff every dust interval', () => {
    const framesBeforeSecondPuff = Math.ceil(DUST_INTERVAL_MS / FRAME_MS)

    story(
      update,
      given(playingModel),
      message(Message.PressedKey({ code: 'KeyD' })),
      tick(FRAME_MS),
      model(({ particles }) => {
        expect(countKind(particles, 'Dust')).toBe(1)
      }),
      ...ticks(framesBeforeSecondPuff - 2, FRAME_MS),
      model(({ particles }) => {
        expect(countKind(particles, 'Dust')).toBe(1)
      }),
      tick(FRAME_MS),
      model(({ particles }) => {
        expect(countKind(particles, 'Dust')).toBe(2)
      }),
    )
  })

  test('particle and decal caps hold under a flood of kills', () => {
    const floodSize = 40
    const victims = Array.makeBy(floodSize, index =>
      modifyFields(
        zombieAt(200 + index, openFloorSpot(index).x, openFloorSpot(index).y, {
          speed: 0,
        }),
        { hp: () => 1 },
      ),
    )
    const killingBullets = Array.map(victims, ({ id, x, y }): Bullet => ({
      id: id + floodSize,
      x,
      y,
      velocityX: 1,
      velocityY: 0,
      remainingMs: 900,
      weapon: 'Pistol',
      damage: 1,
      knockback: 110,
      glaze: 'Plain',
      pierce: Pierce.Stops(),
    }))
    const oldDecal: Decal = { kind: 'Shell', x: 1, y: 1, width: 2, height: 1 }
    const floodModel = modifyFields(withZombies(playingModel, victims), {
      bullets: () => killingBullets,
      decals: () => Array.makeBy(DECAL_MAX, () => oldDecal),
    })

    story(
      update,
      given(floodModel),
      tick(FRAME_MS),
      model(({ particles, stats }) => {
        expect(scoreOf(stats)).toBe(floodSize * SCORE_PER_ZOMBIE)
        expect(particles).toHaveLength(PARTICLE_MAX)
      }),
      ...landingFrames,
      model(({ particles, decals }) => {
        expect(particles).toEqual([])
        expect(decals).toHaveLength(DECAL_MAX)
        expect(countKind(decals, 'Shell')).toBeLessThan(DECAL_MAX)
        expect(Array.last(decals)).not.toEqual(Option.some(oldDecal))
      }),
    )
  })

  test('a new round clears the particles and decals', () => {
    const messyModel = modifyFields(playingModel, {
      phase: () => Phase.GameOver({ wave: 2 }),
      screenMs: () => RESTART_GRACE_MS,
      particles: () => [
        {
          kind: 'MeatGib',
          x: 40,
          y: 40,
          z: 3,
          velocityX: 0,
          velocityY: 0,
          velocityZ: 10,
          size: 2,
          remainingMs: 500,
        },
      ],
      decals: () => [{ kind: 'Blood', x: 50, y: 50, width: 2, height: 1 }],
      dustCooldownMs: () => 40,
    })

    story(
      update,
      given(messyModel),
      message(Message.PressedKey({ code: 'Enter' })),
      model(({ phase, particles, decals, dustCooldownMs }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(particles).toEqual([])
        expect(decals).toEqual([])
        expect(dustCooldownMs).toBe(0)
      }),
    )
  })

  const playParticleSession = (seed: number): Model => {
    const sessions: Array<Model> = []
    story(
      update,
      given(
        withZombies(
          modifyFields(playingModel, { cosmeticRngState: () => seed }),
          [
            zombieAt(100, 200, PARLOUR.height / 2, { speed: 0 }),
            zombieAt(101, 230, PARLOUR.height / 2, { speed: 0 }),
            zombieAt(102, 260, PARLOUR.height / 2, { speed: 0 }),
          ],
        ),
      ),
      holdFire,
      message(Message.PressedKey({ code: 'KeyD' })),
      ...ticks(40, FRAME_MS),
      model(finalModel => {
        sessions.push(finalModel)
      }),
    )
    return Option.getOrThrow(Array.head(sessions))
  }

  test('the same seed and Messages produce the same particles and decals', () => {
    const first = playParticleSession(1234)
    const second = playParticleSession(1234)

    expect(countKind(first.particles, 'MeatGib')).toBeGreaterThan(0)
    expect(countKind(first.particles, 'Dust')).toBeGreaterThan(0)
    expect(first.decals.length).toBeGreaterThan(0)
    expect(second.particles).toEqual(first.particles)
    expect(second.decals).toEqual(first.decals)
    expect(second.rngState).toBe(first.rngState)
  })

  test('a different seed scatters the particles differently', () => {
    expect(playParticleSession(1234).particles).not.toEqual(
      playParticleSession(98765).particles,
    )
  })
})

const doomedZombieAt = (id: number, x: number, y: number): Zombie =>
  modifyFields(zombieAt(id, x, y, { speed: 0 }), { hp: () => 1 })

const massacreModel = (count: number): Model => {
  const victims = Array.makeBy(count, index =>
    doomedZombieAt(300 + index, openFloorSpot(index).x, openFloorSpot(index).y),
  )
  return modifyFields(withZombies(playingModel, victims), {
    bullets: () =>
      Array.map(victims, victim => bulletInto(victim.id + count, victim)),
  })
}

const contactZombie = (id: number): Zombie =>
  zombieAt(id, PARLOUR.width / 2 + 2, PARLOUR.height / 2, { speed: 0 })

const BYSTANDER_ID = 401
const BYSTANDER_X = 100
const BYSTANDER_SPEED = 20
const STRAY_BULLET: Bullet = {
  id: 600,
  x: 20,
  y: 160,
  velocityX: 60,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
  damage: 1,
  knockback: 110,
  glaze: 'Plain',
  pierce: Pierce.Stops(),
}

const freezeVictim = doomedZombieAt(400, 250, 30)

const freezeModel: Model = modifyFields(
  withZombies(playingModel, [
    freezeVictim,
    zombieAt(BYSTANDER_ID, BYSTANDER_X, PARLOUR.height / 2, {
      speed: BYSTANDER_SPEED,
    }),
  ]),
  { bullets: () => [bulletInto(500, freezeVictim), STRAY_BULLET] },
)

const bystanderX = ({ zombies }: Model): number =>
  pipe(
    zombies,
    Array.findFirst(({ id }) => id === BYSTANDER_ID),
    Option.map(({ x }) => x),
    Option.getOrElse(() => Number.NaN),
  )

const strayBulletX = ({ bullets }: Model): number =>
  pipe(
    bullets,
    Array.findFirst(({ id }) => id === STRAY_BULLET.id),
    Option.map(({ x }) => x),
    Option.getOrElse(() => Number.NaN),
  )

const expectWorldAdvancedBy = (nextModel: Model, worldMs: number): void => {
  expect(nextModel.elapsedMs).toBe(worldMs)
  expect(bystanderX(nextModel)).toBeCloseTo(
    BYSTANDER_X + (BYSTANDER_SPEED * worldMs) / 1000,
  )
  expect(strayBulletX(nextModel)).toBeCloseTo(
    STRAY_BULLET.x + (STRAY_BULLET.velocityX * worldMs) / 1000,
  )
}

const kindsAndValues = (model_: Model) =>
  Array.map(model_.popups, ({ kind, value }) => [kind, value])

describe('screen shake', () => {
  test('a shot, a kill, and a hurt add rising trauma', () => {
    story(
      update,
      given(playingModel),
      holdFire,
      tick(FRAME_MS),
      model(({ shake }) => {
        expect(shake).toEqual({ trauma: 0, offset: { x: 0, y: 0 } })
      }),
    )

    story(
      update,
      given(withZombies(playingModel, [doomedZombieAt(100, MUZZLE_X, 90)])),
      holdFire,
      tick(FRAME_MS),
      model(({ shake }) => {
        expect(shake.trauma).toBeCloseTo(SHAKE_TRAUMA_KILL)
      }),
    )

    story(
      update,
      given(withZombies(playingModel, [contactZombie(100)])),
      tick(FRAME_MS),
      model(({ shake }) => {
        expect(shake.trauma).toBeCloseTo(SHAKE_TRAUMA_HURT)
      }),
    )

    expect(SHAKE_TRAUMA_HURT).toBeGreaterThan(SHAKE_TRAUMA_KILL * 4)
  })

  const holdingSpare = (weapon: 'Shotgun' | 'Smg'): Model =>
    modifyFields(playingModel, {
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            holdingSecond({ kind: weapon, rounds: 999, loaded: 999, tier: 0 }),
        }),
    })

  const shakeWhileFiring = (
    base: Model,
  ): ReadonlyArray<Readonly<{ trauma: number; x: number; y: number }>> => {
    const frames: Array<Readonly<{ trauma: number; x: number; y: number }>> = []
    story(
      update,
      given(base),
      holdFire,
      ...Array.flatMap(ticks(180, FRAME_MS), frame => [
        frame,
        model(({ shake }: Model) => {
          frames.push({ trauma: shake.trauma, ...shake.offset })
        }),
      ]),
      model(({ stats }) => {
        expect(stats.shotsFired).toBeGreaterThan(2)
      }),
    )
    return frames
  }

  test('held fire from the pistol and the Chatterbox never moves the screen', () => {
    Array.forEach([playingModel, holdingSpare('Smg')], base => {
      expect(
        Array.every(shakeWhileFiring(base), ({ x, y }) => x === 0 && y === 0),
      ).toBe(true)
    })
  })

  test('held fire from the Barn Buster kicks a little and stays under the firing cap', () => {
    const frames = shakeWhileFiring(holdingSpare('Shotgun'))
    expect(Array.some(frames, ({ trauma }) => trauma > 0)).toBe(true)
    expect(
      Array.every(
        frames,
        ({ trauma, x, y }) =>
          trauma <= SHAKE_FIRING_TRAUMA_MAX &&
          Math.abs(x) <= 1 &&
          Math.abs(y) <= 1,
      ),
    ).toBe(true)
  })

  test('trauma is capped, stays on whole pixels within the max, and decays to rest', () => {
    // NOTE: one tick more than the exact decay, since whole ticks of
    // 1000/60 ms sum a hair short of it.
    const decayFrames =
      Math.ceil(SHAKE_TRAUMA_MAX / SHAKE_DECAY_PER_SECOND / (FRAME_MS / 1000)) +
      1
    const offsets: Array<{ x: number; y: number }> = []
    const recordOffset = model(({ shake }: Model) => {
      offsets.push(shake.offset)
    })

    story(
      update,
      given(massacreModel(10)),
      tick(FRAME_MS),
      model(({ shake }) => {
        expect(shake.trauma).toBe(SHAKE_TRAUMA_MAX)
      }),
      ...Array.flatMap(ticks(decayFrames, FRAME_MS), frame => [
        frame,
        recordOffset,
      ]),
      model(({ shake }) => {
        expect(shake).toEqual({ trauma: 0, offset: { x: 0, y: 0 } })
      }),
    )

    expect(Array.some(offsets, ({ x, y }) => x !== 0 || y !== 0)).toBe(true)
    expect(
      Array.every(
        offsets,
        ({ x, y }) =>
          Number.isInteger(x) &&
          Number.isInteger(y) &&
          Math.abs(x) <= SHAKE_MAX_PX &&
          Math.abs(y) <= SHAKE_MAX_PX,
      ),
    ).toBe(true)
  })
})

describe('hit-stop', () => {
  test('a kill freezes zombies, bullets, and time for the stop, then resumes', () => {
    const frozenTicks = freezeTicks(HIT_STOP_KILL_MS)

    story(
      update,
      given(freezeModel),
      tick(FRAME_MS),
      model(nextModel => {
        expect(Array.map(nextModel.frameEvents, ({ _tag }) => _tag)).toEqual([
          'ZombieHit',
          'ZombieKilled',
        ])
        expect(nextModel.hitStop).toEqual(
          HitStop.Frozen({ remainingMs: HIT_STOP_KILL_MS }),
        )
        expectWorldAdvancedBy(nextModel, FRAME_MS)
      }),
      tick(FRAME_MS),
      model(nextModel => {
        expect(nextModel.frameEvents).toEqual([])
        expect(HitStop.guards.Frozen(nextModel.hitStop)).toBe(true)
        expectWorldAdvancedBy(nextModel, FRAME_MS)
      }),
      ...ticks(frozenTicks - 1, FRAME_MS),
      model(nextModel => {
        expect(HitStop.guards.Running(nextModel.hitStop)).toBe(true)
        expectWorldAdvancedBy(nextModel, FRAME_MS)
      }),
      tick(FRAME_MS),
      model(nextModel => {
        expectWorldAdvancedBy(nextModel, 2 * FRAME_MS)
      }),
      tick(FRAME_MS),
      model(nextModel => {
        expectWorldAdvancedBy(nextModel, 3 * FRAME_MS)
      }),
    )
  })

  test('a hurt freezes longer than a kill', () => {
    story(
      update,
      given(withZombies(playingModel, [contactZombie(100)])),
      tick(FRAME_MS),
      model(({ hitStop }) => {
        expect(hitStop).toEqual(
          HitStop.Frozen({ remainingMs: HIT_STOP_HURT_MS }),
        )
      }),
      ...waitOutFreeze(HIT_STOP_HURT_MS),
      model(({ hitStop, elapsedMs }) => {
        expect(HitStop.guards.Running(hitStop)).toBe(true)
        expect(elapsedMs).toBe(FRAME_MS)
      }),
    )

    expect(HIT_STOP_HURT_MS).toBeGreaterThan(HIT_STOP_KILL_MS)
  })

  test('overlapping kills do not stretch the stop past its cap', () => {
    story(
      update,
      given(massacreModel(30)),
      tick(FRAME_MS),
      model(({ hitStop, stats }) => {
        expect(scoreOf(stats)).toBe(30 * SCORE_PER_ZOMBIE)
        expect(hitStop).toEqual(
          HitStop.Frozen({ remainingMs: HIT_STOP_KILL_MAX_MS }),
        )
      }),
    )

    story(
      update,
      given(
        modifyFields(massacreModel(3), {
          zombies: zombies => [...zombies, contactZombie(700)],
        }),
      ),
      tick(FRAME_MS),
      model(({ hitStop }) => {
        expect(hitStop).toEqual(
          HitStop.Frozen({ remainingMs: HIT_STOP_MAX_MS }),
        )
      }),
    )
  })

  test('a kill right after a stop ends does not freeze again', () => {
    story(
      update,
      given(
        modifyFields(freezeModel, {
          hitStop: () => HitStop.Running({ cooldownMs: HIT_STOP_COOLDOWN_MS }),
        }),
      ),
      tick(FRAME_MS),
      model(({ hitStop, frameEvents }) => {
        expect(Array.some(frameEvents, GameEvent.guards.ZombieKilled)).toBe(
          true,
        )
        expect(hitStop).toEqual(
          HitStop.Running({ cooldownMs: HIT_STOP_COOLDOWN_MS - FRAME_MS }),
        )
      }),
    )
  })

  test('input during a stop is kept and acted on when it resumes', () => {
    story(
      update,
      given(freezeModel),
      tick(FRAME_MS),
      message(Message.PressedKey({ code: 'KeyD' })),
      tick(FRAME_MS),
      model(({ player, intent, input }) => {
        expect(input.pressedKeys).toEqual(['KeyD'])
        expect(intent.move).toEqual({ x: 1, y: 0 })
        expect(player.x).toBe(PARLOUR.width / 2)
      }),
      ...ticks(freezeTicks(HIT_STOP_KILL_MS) - 1, FRAME_MS),
      model(({ player }) => {
        expect(player.x).toBe(PARLOUR.width / 2)
      }),
      tick(FRAME_MS),
      model(({ player }) => {
        expect(player.x).toBeCloseTo(
          PARLOUR.width / 2 + (PLAYER_SPEED * FRAME_MS) / 1000,
        )
      }),
    )
  })

  test('a new round clears the stop, the shake, the numbers, and the streak', () => {
    story(
      update,
      given(massacreModel(4)),
      tick(FRAME_MS),
      model(nextModel => {
        expect(HitStop.guards.Frozen(nextModel.hitStop)).toBe(true)
        expect(nextModel.shake.trauma).toBeGreaterThan(0)
        expect(nextModel.popups).not.toEqual([])
        expect(Streak.guards.Hot(nextModel.streak)).toBe(true)
      }),
      message(Message.PressedKey({ code: 'Escape' })),
      message(Message.PressedKey({ code: 'Escape' })),
      model(({ phase }) => {
        expect(Phase.guards.Wave(phase)).toBe(true)
      }),
    )

    story(
      update,
      given(
        modifyFields(massacreModel(4), {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => RESTART_GRACE_MS,
          hitStop: () => HitStop.Frozen({ remainingMs: 30 }),
          shake: () => ({ trauma: 0.5, offset: { x: 1, y: -1 } }),
          streak: () => Streak.Hot({ count: 4, remainingMs: 100 }),
        }),
      ),
      message(Message.PressedKey({ code: 'Enter' })),
      model(nextModel => {
        expect(nextModel.hitStop).toEqual(initialModel.hitStop)
        expect(nextModel.shake).toEqual(initialModel.shake)
        expect(nextModel.popups).toEqual([])
        expect(nextModel.streak).toEqual(Streak.Cold())
      }),
    )
  })
})

describe('damage numbers', () => {
  test('a hit pops the damage dealt and a kill pops the money it pays', () => {
    story(
      update,
      given(
        withZombies(playingModel, [zombieAt(100, MUZZLE_X, 90, { speed: 0 })]),
      ),
      holdFire,
      tick(FRAME_MS),
      model(nextModel => {
        expect(kindsAndValues(nextModel)).toEqual([['Damage', PISTOL_DAMAGE]])
      }),
    )

    story(
      update,
      given(withZombies(playingModel, [doomedZombieAt(100, MUZZLE_X, 90)])),
      holdFire,
      tick(FRAME_MS),
      model(nextModel => {
        expect(kindsAndValues(nextModel)).toEqual([
          ['Damage', PISTOL_DAMAGE],
          ['Kill', SHAMBLER_BOUNTY],
        ])
      }),
    )
  })

  test('numbers age through the stop and expire after their lifetime', () => {
    const damageFrames = Math.ceil(DAMAGE_POPUP_LIFETIME_MS / FRAME_MS)
    const killFrames = Math.ceil(KILL_POPUP_LIFETIME_MS / FRAME_MS)

    story(
      update,
      given(withZombies(playingModel, [doomedZombieAt(100, MUZZLE_X, 90)])),
      holdFire,
      tick(FRAME_MS),
      releaseFire,
      tick(FRAME_MS),
      model(({ popups, hitStop }) => {
        expect(HitStop.guards.Frozen(hitStop)).toBe(true)
        expect(Array.map(popups, ({ ageMs }) => ageMs)).toEqual([
          FRAME_MS,
          FRAME_MS,
        ])
      }),
      ...ticks(damageFrames - 1, FRAME_MS),
      model(({ popups }) => {
        expect(Array.map(popups, ({ kind }) => kind)).toEqual(['Kill'])
      }),
      ...ticks(killFrames - damageFrames, FRAME_MS),
      model(({ popups }) => {
        expect(popups).toEqual([])
      }),
    )
  })

  test('the live count never passes the cap and keeps the newest', () => {
    story(
      update,
      given(massacreModel(20)),
      tick(FRAME_MS),
      model(({ popups }) => {
        expect(popups).toHaveLength(POPUP_MAX)
        expect(Array.every(popups, ({ ageMs }) => ageMs === 0)).toBe(true)
      }),
    )
  })
})

describe('kill streak', () => {
  test('counts kills, holds through the stop, and goes cold after a gap', () => {
    const coldFrames = Math.ceil(STREAK_WINDOW_MS / FRAME_MS)

    story(
      update,
      given(massacreModel(3)),
      tick(FRAME_MS),
      model(({ streak }) => {
        expect(streak).toEqual(
          Streak.Hot({ count: 3, remainingMs: STREAK_WINDOW_MS }),
        )
      }),
      ...waitOutFreeze(HIT_STOP_KILL_MAX_MS),
      model(({ streak }) => {
        expect(streak).toEqual(
          Streak.Hot({ count: 3, remainingMs: STREAK_WINDOW_MS }),
        )
      }),
      ...ticks(coldFrames, FRAME_MS),
      model(({ streak }) => {
        expect(streak).toEqual(Streak.Cold())
      }),
    )
  })
})

describe('juice determinism', () => {
  const bigKillAt = (id: number, x: number): Zombie =>
    modifyFields(zombieAt(id, x, PARLOUR.height / 2, { speed: 0 }), {
      kind: () => 'Tank',
    })

  const playJuiceSession = (seed: number): ReadonlyArray<Model> => {
    const frames: Array<Model> = []
    const record = model((frame: Model) => {
      frames.push(frame)
    })
    story(
      update,
      given(
        withZombies(
          modifyFields(playingModel, { cosmeticRngState: () => seed }),
          [bigKillAt(100, 200), bigKillAt(101, 230), bigKillAt(102, 260)],
        ),
      ),
      holdFire,
      ...Array.flatMap(ticks(60, FRAME_MS), frame => [frame, record]),
    )
    return frames
  }

  const juiceOf = ({ shake, hitStop, popups, streak }: Model) => ({
    shake,
    hitStop,
    popups,
    streak,
  })

  test('the same seed and Messages give the same shake, stops, and numbers', () => {
    const first = playJuiceSession(1234)
    const second = playJuiceSession(1234)

    expect(
      Array.some(first, ({ hitStop }) => HitStop.guards.Frozen(hitStop)),
    ).toBe(true)
    expect(
      Array.some(
        first,
        ({ shake }) => shake.offset.x !== 0 || shake.offset.y !== 0,
      ),
    ).toBe(true)
    expect(Array.map(second, juiceOf)).toEqual(Array.map(first, juiceOf))
  })

  test('a different seed shakes differently', () => {
    expect(
      Array.map(playJuiceSession(98765), ({ shake }) => shake),
    ).not.toEqual(Array.map(playJuiceSession(1234), ({ shake }) => shake))
  })
})
