import { Array, Option, Result, pipe } from 'effect'
import {
  Command,
  type StorySimulation,
  given,
  model,
  story,
} from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR } from './arena'
import { DECAL_MAX, FIXED_STEP_MS, PARTICLE_MAX } from './constants'
import { healthBarShapes } from './healthBarView'
import { update } from './main'
import { Message } from './message'
import {
  AudioState,
  type Bullet,
  type Decal,
  GameEvent,
  type Model,
  type Particle,
  type ParticleKind,
  type Zombie,
  ZombieKind,
} from './model'
import { quietWave } from './model.fixture'
import { frameAt } from './sprite'
import {
  KABOOMER_FUSE_MAX,
  ZOMBIE_SPRITES,
  kaboomerFuseTip,
} from './sprites/zombies'
import { bulletInto, tick, zombieOf } from './testing'
import { PlaySound } from './update/sound'
import { zombieHealthBarShapes } from './zombieView'
import { ZOMBIE_KINDS, isArmorPart, isArmorShedAt, wearAt } from './zombies'

const FRAME_MS = FIXED_STEP_MS
const FAR_X = PARLOUR.width / 2 + 60
const ROW_Y = PARLOUR.height / 2

const withScene = (
  zombies: ReadonlyArray<Zombie>,
  bullets: ReadonlyArray<Bullet> = [],
): Model =>
  modifyFields(quietWave(1), {
    zombies: () => zombies,
    bullets: () => bullets,
  })

const shedIn = (
  events: ReadonlyArray<GameEvent>,
): ReadonlyArray<Readonly<{ kind: ZombieKind; stage: number }>> =>
  Array.filterMap(events, event =>
    GameEvent.isAnyOf(['PartShed'])(event)
      ? Result.succeed({ kind: event.kind, stage: event.stage })
      : Result.failVoid,
  )

const reload = (current: Model, bullets: ReadonlyArray<Bullet>): Model =>
  modifyFields(current, { bullets: () => bullets })

type WearCase = Readonly<{
  kind: ZombieKind
  maxHp: number
  stages: ReadonlyArray<number>
}>

const WEAR_CASES: ReadonlyArray<WearCase> = [
  { kind: 'Shambler', maxHp: 3, stages: [0, 1, 2] },
  { kind: 'Shambler', maxHp: 4, stages: [0, 0, 1, 2] },
  { kind: 'Runner', maxHp: 2, stages: [0, 1] },
  { kind: 'Exploder', maxHp: 3, stages: [0, 1, 2] },
  { kind: 'Exploder', maxHp: 4, stages: [0, 0, 1, 2] },
]

describe('wear stages', () => {
  test.each(WEAR_CASES)(
    'a $kind with $maxHp health wears by its health share',
    ({ kind, maxHp, stages }) => {
      const worn = Array.makeBy(maxHp, index =>
        wearAt(kind, maxHp - index, maxHp),
      )
      expect(worn).toEqual(stages)
    },
  )

  test('a Big Lug sheds at three quarters, half, and a quarter', () => {
    const maxHp = 36
    expect(wearAt('Tank', 36, maxHp)).toBe(0)
    expect(wearAt('Tank', 28, maxHp)).toBe(0)
    expect(wearAt('Tank', 27, maxHp)).toBe(1)
    expect(wearAt('Tank', 19, maxHp)).toBe(1)
    expect(wearAt('Tank', 18, maxHp)).toBe(2)
    expect(wearAt('Tank', 10, maxHp)).toBe(2)
    expect(wearAt('Tank', 9, maxHp)).toBe(3)
    expect(wearAt('Tank', 1, maxHp)).toBe(3)
  })

  test('the boss sheds a part every fifth of its health', () => {
    const maxHp = 200
    expect(
      Array.map([200, 161, 160, 121, 120, 81, 80, 41, 40, 1], hp =>
        wearAt('Boss', hp, maxHp),
      ),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  })

  test('every kind has a worn sprite for each stage, each one different', () => {
    Array.forEach(ZombieKind.literals, kind => {
      const { stages } = ZOMBIE_SPRITES[kind]
      expect(stages.length).toBe(ZOMBIE_KINDS[kind].wear.length + 1)
      const looks = Array.map(
        stages,
        ({ walk }) => frameAt(walk, 0).Normal.Right,
      )
      Array.forEach(Array.drop(looks, 1), (look, index) => {
        expect(look).not.toEqual(looks[index])
      })
    })
  })
})

describe('parts coming off', () => {
  test('a Groaner sheds its arm, then its scalp, once each, and nothing on the kill', () => {
    const groaner = zombieOf('Shambler', 100, FAR_X, ROW_Y, { hp: 3 })
    const shed: Array<
      ReadonlyArray<Readonly<{ kind: ZombieKind; stage: number }>>
    > = []
    const record = model((current: Model) => {
      shed.push(shedIn(current.frameEvents))
    })
    story(
      update,
      given(withScene([groaner], [bulletInto(500, groaner)])),
      tick(FRAME_MS),
      record,
      tick(FRAME_MS),
      record,
      model(current => {
        expect(current.zombies[0]?.hp).toBe(2)
      }),
    )
    expect(shed).toEqual([[{ kind: 'Shambler', stage: 0 }], []])

    const halfWorn = modifyFields(groaner, { hp: () => 2 })
    const nearlyGone = modifyFields(groaner, { hp: () => 1 })
    story(
      update,
      given(withScene([halfWorn], [bulletInto(501, halfWorn)])),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(shedIn(frameEvents)).toEqual([{ kind: 'Shambler', stage: 1 }])
      }),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(shedIn(frameEvents)).toEqual([])
      }),
    )
    story(
      update,
      given(withScene([nearlyGone], [bulletInto(502, nearlyGone)])),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(
          Array.some(frameEvents, GameEvent.isAnyOf(['ZombieKilled'])),
        ).toBe(true)
        expect(shedIn(frameEvents)).toEqual([])
      }),
    )
  })

  test('one big hit past two thresholds sheds both parts in order', () => {
    const lug = zombieOf('Tank', 100, FAR_X, ROW_Y, { hp: 36 })
    story(
      update,
      given(withScene([lug], [bulletInto(500, lug, { damage: 19 })])),
      tick(FRAME_MS),
      model(({ frameEvents, zombies }) => {
        expect(zombies[0]?.hp).toBe(17)
        expect(shedIn(frameEvents)).toEqual([
          { kind: 'Tank', stage: 0 },
          { kind: 'Tank', stage: 1 },
        ])
      }),
    )
  })

  test('the part flies off and lands as a decal that stays', () => {
    const groaner = zombieOf('Shambler', 100, FAR_X, ROW_Y, { hp: 3 })
    const landed: Array<ReadonlyArray<Decal>> = []
    story(
      update,
      given(withScene([groaner], [bulletInto(500, groaner)])),
      tick(FRAME_MS),
      model(({ particles }) => {
        const arms = Array.filter(particles, ({ kind }) => kind === 'GreenLimb')
        expect(arms).toHaveLength(1)
        expect(Array.every(arms, ({ velocityZ }) => velocityZ > 0)).toBe(true)
      }),
      ...Array.makeBy(150, () => tick(FRAME_MS)),
      model(({ decals, particles }) => {
        landed.push(decals)
        expect(
          Array.filter(particles, ({ kind }) => kind === 'GreenLimb'),
        ).toHaveLength(0)
      }),
    )
    expect(
      Array.filter(landed[0] ?? [], ({ kind }) => kind === 'GreenLimb'),
    ).toHaveLength(1)
  })
})

describe('caps', () => {
  const crowd = Array.makeBy(18, index =>
    zombieOf(
      'Tank',
      200 + index,
      40 + (index % 9) * 28,
      82 + Math.floor(index / 9) * 14,
      { hp: 36 },
    ),
  )

  const fullParticle = (index: number): Particle => ({
    kind: 'Blood',
    x: 30 + index,
    y: 30,
    z: 20,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    size: 1,
    remainingMs: 60_000,
  })

  const fullDecal = (index: number): Decal => ({
    kind: 'Blood',
    x: 20 + (index % 200),
    y: 20,
    width: 1,
    height: 1,
  })

  test('a whole crowd shedding at once never passes the particle or decal caps', () => {
    const packed = modifyFields(withScene(crowd), {
      particles: () => Array.makeBy(PARTICLE_MAX, fullParticle),
      decals: () => Array.makeBy(DECAL_MAX, fullDecal),
    })
    const heavyHits = (current: Model): Model =>
      reload(
        current,
        Array.map(current.zombies, (zombie, index) =>
          bulletInto(900 + index, zombie, { damage: 9 }),
        ),
      )
    const shedCounts: Array<number> = []
    story(
      update,
      given(heavyHits(packed)),
      tick(FRAME_MS),
      model(current => {
        shedCounts.push(shedIn(current.frameEvents).length)
        expect(current.particles.length).toBeLessThanOrEqual(PARTICLE_MAX)
        expect(current.decals.length).toBeLessThanOrEqual(DECAL_MAX)
      }),
      ...Array.makeBy(200, () => tick(FRAME_MS)),
      model(current => {
        expect(current.particles.length).toBeLessThanOrEqual(PARTICLE_MAX)
        expect(current.decals.length).toBe(DECAL_MAX)
        expect(
          Array.some(current.decals, ({ kind }) => kind === 'PotLid'),
        ).toBe(true)
      }),
    )
    expect(shedCounts).toEqual([crowd.length])
  })
})

describe('the Big Lug armor', () => {
  const ARMOR: ReadonlyArray<
    Readonly<{ stage: number; hp: number; part: ParticleKind }>
  > = [
    { stage: 0, hp: 36, part: 'PotLid' },
    { stage: 1, hp: 27, part: 'StopSign' },
    { stage: 2, hp: 18, part: 'Bucket' },
  ]

  const lugAt = (hp: number): Zombie =>
    modifyFields(zombieOf('Tank', 100, FAR_X, ROW_Y, { hp: 36 }), {
      hp: () => hp,
    })

  const soundsOf = (
    commands: StorySimulation<Model, Message>['commands'],
  ): ReadonlyArray<unknown> =>
    pipe(
      commands,
      Array.filter(command => command.name === PlaySound.name),
      Array.map(command => command.args?.['sound']),
    )

  type PlaySoundResolver = readonly [
    typeof PlaySound,
    typeof Message.CompletedPlaySound.Type,
  ]

  const playedResolver = (): PlaySoundResolver => [
    PlaySound,
    Message.CompletedPlaySound({ sound: 'Clang', outcome: 'Played' }),
  ]

  const heardSounds: Array<ReadonlyArray<unknown>> = []
  const hear = <StoryModel, StoryMessage, OutMessage>(
    simulation: StorySimulation<StoryModel, StoryMessage, OutMessage>,
  ): StorySimulation<StoryModel, StoryMessage, OutMessage> => {
    heardSounds.push(soundsOf(simulation.commands))
    return simulation
  }

  const countOf = (
    items: ReadonlyArray<Readonly<{ kind: string }>>,
    kind: string,
  ): number => Array.filter(items, item => item.kind === kind).length

  test.each(ARMOR)(
    'stage $stage knocks off the $part once, with a clang, sparks, and a plate on the floor',
    ({ stage, hp, part }) => {
      heardSounds.length = 0
      const lug = lugAt(hp)
      const scene = withScene([lug], [bulletInto(500, lug, { damage: 9 })])
      story(
        update,
        given(modifyFields(scene, { audio: () => AudioState.Ready() })),
        tick(FRAME_MS),
        hear,
        Command.resolveAll(...Array.makeBy(12, playedResolver)),
      )
      const landed: Array<Model> = []
      story(
        update,
        given(scene),
        tick(FRAME_MS),
        model(({ frameEvents, particles, zombies }) => {
          expect(zombies[0]?.hp).toBe(hp - 9)
          expect(shedIn(frameEvents)).toEqual([{ kind: 'Tank', stage }])
          expect(countOf(particles, part)).toBe(1)
          expect(countOf(particles, 'Spark')).toBeGreaterThan(0)
        }),
        tick(FRAME_MS),
        model(({ frameEvents }) => {
          expect(shedIn(frameEvents)).toEqual([])
        }),
        ...Array.makeBy(150, () => tick(FRAME_MS)),
        model(current => {
          landed.push(current)
        }),
      )
      expect(heardSounds[0]).toContain('Clang')
      expect(heardSounds[0]).not.toContain('LimbPop')
      const after = landed[0]
      expect(after).toBeDefined()
      expect(countOf(after?.decals ?? [], part)).toBe(1)
      expect(countOf(after?.particles ?? [], part)).toBe(0)
    },
  )

  test('the last stage leaves the bare zombie, without any armor in his frames', () => {
    const { stages } = ZOMBIE_SPRITES.Tank
    expect(stages).toHaveLength(ZOMBIE_KINDS.Tank.wear.length + 1)
    const lookAt = (stage: number) =>
      Option.map(Array.get(stages, stage), ({ walk }) => frameAt(walk, 0))
    expect(lookAt(3)).not.toEqual(lookAt(0))
    expect(
      Array.every(ZOMBIE_KINDS.Tank.wear, ({ part }) => isArmorPart(part)),
    ).toBe(true)
  })

  test('a Groaner part is not armor, and every Big Lug stage is', () => {
    expect(isArmorShedAt('Shambler', 0)).toBe(false)
    expect(isArmorShedAt('Tank', 0)).toBe(true)
    expect(isArmorShedAt('Tank', 2)).toBe(true)
  })
})

describe('the Kaboomer health bar', () => {
  const SPARK_REACH_PX = 2

  test('shows once he is hurt, over his fuse, and not before', () => {
    const kaboomer = zombieOf('Exploder', 100, FAR_X, ROW_Y, { hp: 6 })
    expect(zombieHealthBarShapes(kaboomer)).toEqual([])
    const hurt = modifyFields(kaboomer, { hp: () => 3 })
    const bar = zombieHealthBarShapes(hurt)
    expect(bar).toHaveLength(1)
    const back = bar[0]
    const atOrigin = healthBarShapes('Small', 'Zombie', 0, 0, 0.5)[0]
    expect(back?._tag === 'Image' ? back.src : '').toBe(
      atOrigin?._tag === 'Image' ? atOrigin.src : 'none',
    )
    expect(back?._tag === 'Image' ? back.crop : 'none').toEqual(
      atOrigin?._tag === 'Image' ? atOrigin.crop : 'other',
    )
    const fuseTipY =
      Math.round(hurt.y) +
      ZOMBIE_KINDS.Exploder.footOffset +
      kaboomerFuseTip(KABOOMER_FUSE_MAX, 0, 'Right').y
    const barBottom = back?._tag === 'Image' ? back.y + back.height : 0
    expect(barBottom).toBeLessThan(fuseTipY - SPARK_REACH_PX)
  })
})
