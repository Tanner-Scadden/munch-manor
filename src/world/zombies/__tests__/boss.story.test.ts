import { Array, Effect, Option } from 'effect'
import { type Canvas, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import {
  Boss,
  BossMove,
  type DoorId,
  type GameEvent,
  type Model,
  Phase,
  RunMode,
  type Zombie,
} from '../../../app/model'
import { BOSS_ICON } from '../../../art/sprites/zombies'
import { wavePreviewShapes } from '../../../features/hud/wavePreview'
import { cameraOf } from '../../../render/camera'
import { PACK_WARNING_MS } from '../../../shared/constants'
import { newPlayerReady, withPlayerAt } from '../../../test/model.fixture'
import {
  APPLICATION,
  FRAME_MS,
  bulletInto,
  tick,
  ticks,
  ticksFor,
  zombieOf,
} from '../../../test/testing'
import { START_LEVEL } from '../../level/arena'
import { DOOR_IDS } from '../../level/tileGrid'
import { doorSpawnPoint } from '../../level/tileQueries'
import { DIFFICULTIES } from '../../run/difficulty'
import { hpScaleFor, rollSpawns } from '../../waves/endlessWaves'
import { FINAL_WAVE, WAVE_PLANS } from '../../waves/wavePlans'
import {
  freshFight,
  hasBoss,
  maybeBossBar,
  maybeBossDoor,
  planBoss,
} from '../boss'
import { BOSS_RULES } from '../bossRules'
import { ZOMBIE_KINDS, scaledHp } from '../zombies'
import {
  BOSS_HP,
  CENTER_X,
  CENTER_Y,
  bossAt,
  bossWithHpAt,
  eventsTagged,
  fightingBoss,
  fightingWith,
  inWave,
  spawnAt,
  sturdy,
} from './boss.fixture'

const DOOMED: Zombie = zombieOf('Shambler', 100, CENTER_X + 30, CENTER_Y, {
  hp: 1,
})

const clearing = (wave: number): Model =>
  modifyFields(newPlayerReady, {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [] }),
    zombies: () => [DOOMED],
    bullets: () => [bulletInto(500, DOOMED)],
  })

const preparationOf = (current: Model) =>
  Option.getOrThrow(
    Option.liftPredicate(current.phase, Phase.guards.Preparation),
  )

const inEndless = (model: Model): Model =>
  modifyFields(model, { mode: () => RunMode.Endless() })

describe('planning the boss', () => {
  test('only every tenth wave has a boss', () => {
    expect(FINAL_WAVE).toBe(BOSS_RULES.everyWaves)
    expect(
      Array.filter(
        Array.makeBy(30, index => index + 1),
        hasBoss,
      ),
    ).toEqual([10, 20, 30])
  })

  it.effect('an escape run never plans him by wave number', () =>
    Story.story(
      APPLICATION,
      Story.given(clearing(FINAL_WAVE - 1)),
      tick(FRAME_MS),
      Story.model(current => {
        expect(preparationOf(current).wave).toBe(FINAL_WAVE)
        expect(current.boss).toEqual(Boss.Absent())
      }),
    ),
  )

  it.effect(
    'in endless, clearing wave 9 plans a boss at a door that waits out two thirds of wave 10',
    () =>
      Story.story(
        APPLICATION,
        Story.given(inEndless(clearing(FINAL_WAVE - 1))),
        tick(FRAME_MS),
        Story.model(current => {
          const preparation = preparationOf(current)
          expect(preparation.wave).toBe(FINAL_WAVE)
          const waiting = Option.getOrThrow(
            Option.liftPredicate(current.boss, Boss.guards.Waiting),
          )
          expect(DOOR_IDS).toContain(waiting.door)
          expect(waiting.waitBelow).toBe(
            Math.round(preparation.spawns.length / 3),
          )
          expect(waiting.hp).toBe(
            scaledHp(
              ZOMBIE_KINDS.Boss.hp,
              (WAVE_PLANS[FINAL_WAVE - 1]?.hpScale ?? 1) *
                DIFFICULTIES.Normal.healthScale,
            ),
          )
        }),
      ),
  )

  it.effect.each(['Hard', 'Nightmare'] as const)(
    'on %s he takes his own boss health on top of the level health',
    level =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(inEndless(clearing(FINAL_WAVE - 1)), {
            difficulty: setting =>
              modifyFields(setting, { chosen: () => level }),
          }),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          const waiting = Option.getOrThrow(
            Option.liftPredicate(current.boss, Boss.guards.Waiting),
          )
          const { healthScale, bossHealthScale } = DIFFICULTIES[level]
          expect(bossHealthScale).toBeGreaterThan(1)
          expect(waiting.hp).toBe(
            scaledHp(
              ZOMBIE_KINDS.Boss.hp,
              (WAVE_PLANS[FINAL_WAVE - 1]?.hpScale ?? 1) *
                healthScale *
                bossHealthScale,
            ),
          )
          expect(waiting.hp).toBe({ Hard: 214, Nightmare: 323 }[level])
        }),
      ),
  )

  it.effect(
    'endless brings him back every tenth wave with the wave health bonus',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(clearing(19), { mode: () => RunMode.Endless() }),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(preparationOf(current).wave).toBe(20)
          const waiting = Option.getOrThrow(
            Option.liftPredicate(current.boss, Boss.guards.Waiting),
          )
          expect(waiting.hp).toBe(
            scaledHp(
              ZOMBIE_KINDS.Boss.hp,
              hpScaleFor(20) * DIFFICULTIES.Normal.healthScale,
            ),
          )
          expect(waiting.hp).toBeGreaterThan(BOSS_HP)
        }),
      ),
  )

  it.effect('clearing wave 3 plans no boss', () =>
    Story.story(
      APPLICATION,
      Story.given(clearing(3)),
      tick(FRAME_MS),
      Story.model(current => {
        expect(preparationOf(current).wave).toBe(4)
        expect(current.boss).toEqual(Boss.Absent())
      }),
    ),
  )

  test('the same seed draws the same boss door, and seeds differ across doors', () => {
    const doorFor = (seed: number): DoorId => {
      const [state, spawns] = rollSpawns(seed, FINAL_WAVE)
      const [, boss] = planBoss(
        START_LEVEL.doorIds,
        state,
        FINAL_WAVE,
        spawns,
        'Normal',
      )
      return Option.getOrThrow(maybeBossDoor(boss))
    }
    expect(doorFor(42)).toBe(doorFor(42))
    const doors = Array.dedupe(
      Array.map(
        Array.makeBy(40, index => index * 7919 + 1),
        doorFor,
      ),
    )
    expect(doors.length).toBeGreaterThan(1)
  })
})

describe('the entrance', () => {
  const waitingAt = (door: DoorId, waitBelow: number): Boss =>
    Boss.Waiting({ door, waitBelow, hp: BOSS_HP, guestHpScale: 1 })

  it.effect(
    'it stays outside until only its share of spawns is left, then roars at its door',
    () =>
      Effect.gen(function* () {
        const later = Array.makeBy(4, index => spawnAt(1e9, index + 1))
        yield* Story.story(
          APPLICATION,
          Story.given(
            inWave(FINAL_WAVE, [spawnAt(0, 0), ...later], waitingAt('East', 3)),
          ),
          tick(FRAME_MS),
          Story.model(current => {
            expect(Boss.isAnyOf(['Waiting'])(current.boss)).toBe(true)
            expect(eventsTagged(current.frameEvents, 'BossRoared')).toEqual([])
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            inWave(
              FINAL_WAVE,
              [spawnAt(0, 0), ...Array.take(later, 3)],
              waitingAt('East', 3),
            ),
          ),
          tick(FRAME_MS),
          Story.model(current => {
            expect(Boss.isAnyOf(['Arriving'])(current.boss)).toBe(true)
            const [roar] = eventsTagged(current.frameEvents, 'BossRoared')
            expect(roar).toMatchObject({ _tag: 'BossRoared', door: 'East' })
            expect(
              Array.some(current.zombies, ({ kind }) => kind === 'Boss'),
            ).toBe(false)
          }),
        )
      }),
  )

  it.effect(
    'it walks in at its door once the entrance ends, at full health',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          inWave(
            FINAL_WAVE,
            [spawnAt(1e9, 0)],
            Boss.Arriving({
              door: 'West',
              hp: BOSS_HP,
              guestHpScale: 1,
              remainingMs: 40,
              durationMs: BOSS_RULES.entranceMs,
            }),
          ),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(Boss.isAnyOf(['Arriving'])(current.boss)).toBe(true)
        }),
        tick(FRAME_MS),
        tick(FRAME_MS),
        Story.model(current => {
          const boss = Option.getOrThrow(
            Array.findFirst(current.zombies, ({ kind }) => kind === 'Boss'),
          )
          expect(boss.hp).toBe(BOSS_HP)
          expect(boss.maxHp).toBe(BOSS_HP)
          const door = doorSpawnPoint(START_LEVEL, 'West', 0)
          expect(Math.hypot(boss.x - door.x, boss.y - door.y)).toBeLessThan(4)
          expect(current.boss).toEqual(
            freshFight(
              boss.id,
              BossMove.Stalking({ cooldownMs: BOSS_RULES.firstAttackMs }),
              1,
            ),
          )
        }),
      ),
  )
})

describe('the boss has the floor', () => {
  const REJOIN_MS = 5000

  it.effect(
    'the rest of the wave rejoins about 5 seconds after he walks in, warning first',
    () => {
      const soon = [spawnAt(200, 0), spawnAt(1e9, 1)]
      const arriving = Boss.Arriving({
        door: 'West',
        hp: BOSS_HP,
        guestHpScale: 1,
        remainingMs: 1000,
        durationMs: BOSS_RULES.entranceMs,
      })
      const waveClock = (current: Model): number =>
        Phase.isAnyOf(['Wave'])(current.phase) ? current.phase.elapsedMs : -1
      const pending = (current: Model): number =>
        Phase.isAnyOf(['Wave'])(current.phase)
          ? current.phase.spawns.length
          : -1
      const rejoinFrames = Math.ceil(REJOIN_MS / FRAME_MS)
      return Story.story(
        APPLICATION,
        Story.given(sturdy(inWave(FINAL_WAVE, soon, arriving))),
        ...ticks(Math.ceil(1000 / FRAME_MS) + 10, FRAME_MS),
        Story.model(current => {
          expect(Boss.isAnyOf(['Fighting'])(current.boss)).toBe(true)
          expect(waveClock(current)).toBe(0)
          expect(pending(current)).toBe(soon.length)
        }),
        ...ticks(rejoinFrames - 30, FRAME_MS),
        Story.model(current => {
          expect(waveClock(current)).toBe(0)
          expect(pending(current)).toBe(soon.length)
          expect(current.pacing.warnedPacks).toEqual([])
        }),
        ...ticks(50, FRAME_MS),
        Story.model(current => {
          expect(waveClock(current)).toBeGreaterThan(0)
          expect(current.pacing.warnedPacks).toEqual([0])
          expect(pending(current)).toBe(soon.length)
        }),
        ...ticksFor(PACK_WARNING_MS, FRAME_MS),
        Story.model(current => {
          expect(pending(current)).toBe(soon.length - 1)
        }),
      )
    },
  )
})

describe('the health bar', () => {
  it.effect(
    'shows its name and health while it stands, and goes once it falls',
    () => {
      const boss = bossAt(CENTER_X + 60, CENTER_Y)
      const start = inWave(
        FINAL_WAVE,
        [spawnAt(1e9, 0)],
        fightingBoss(BossMove.Stalking({ cooldownMs: 60_000 })),
        [boss],
      )
      expect(maybeBossBar(start)).toEqual(
        Option.some({
          name: 'Uncle Chunk',
          hp: BOSS_HP,
          maxHp: BOSS_HP,
          isEnraged: false,
        }),
      )
      expect(maybeBossBar(newPlayerReady)).toEqual(Option.none())
      return Story.story(
        APPLICATION,
        Story.given(
          modifyFields(start, {
            bullets: () => [bulletInto(1, boss, { damage: 5 })],
          }),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(maybeBossBar(current)).toEqual(
            Option.some({
              name: 'Uncle Chunk',
              hp: BOSS_HP - 5,
              maxHp: BOSS_HP,
              isEnraged: false,
            }),
          )
        }),
      )
    },
  )
})

describe('a boss wave', () => {
  it.effect(
    'waits while the boss is outside or standing, then clears once it falls',
    () =>
      Effect.gen(function* () {
        const waiting = Boss.Waiting({
          door: 'North',
          waitBelow: 0,
          hp: BOSS_HP,
          guestHpScale: 1,
        })
        yield* Story.story(
          APPLICATION,
          Story.given(inWave(FINAL_WAVE, [], waiting)),
          tick(FRAME_MS),
          Story.model(current => {
            expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
            expect(Boss.isAnyOf(['Arriving'])(current.boss)).toBe(true)
          }),
          // NOTE: one tick more than the entrance, as summing 1000/60 ms ticks
          // can leave a hair of it still to run.
          ...ticks(Math.ceil(BOSS_RULES.entranceMs / FRAME_MS) + 1, FRAME_MS),
          Story.model(current => {
            expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
            expect(Boss.isAnyOf(['Fighting'])(current.boss)).toBe(true)
          }),
        )

        const lastLegs = bossWithHpAt(1, CENTER_X + 60, CENTER_Y)
        const frames = Math.ceil(ZOMBIE_KINDS.Boss.dyingMs / FRAME_MS) + 120
        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFields(
              inWave(
                FINAL_WAVE,
                [],
                fightingBoss(BossMove.Stalking({ cooldownMs: 60_000 })),
                [lastLegs],
              ),
              { bullets: () => [bulletInto(1, lastLegs)] },
            ),
          ),
          tick(FRAME_MS),
          Story.model(current => {
            expect(
              eventsTagged(current.frameEvents, 'ZombieKilled'),
            ).toMatchObject([{ kind: 'Boss' }])
            expect(current.hitStop).toMatchObject({
              _tag: 'Slowed',
              carryMs: 0,
            })
            expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
          }),
          ...ticks(frames, FRAME_MS),
          Story.model(current => {
            expect(preparationOf(current).wave).toBe(FINAL_WAVE + 1)
            expect(current.boss).toEqual(Boss.Absent())
          }),
        )
      }),
  )

  it.effect(
    'a Groaner still standing holds victory after the boss falls',
    () => {
      const lastLegs = bossWithHpAt(1, CENTER_X + 60, CENTER_Y)
      const straggler = zombieOf('Shambler', 300, 30, 30, { hp: 3 })
      return Story.story(
        APPLICATION,
        Story.given(
          modifyFields(
            inWave(
              FINAL_WAVE,
              [],
              fightingBoss(BossMove.Stalking({ cooldownMs: 60_000 })),
              [lastLegs, straggler],
            ),
            { bullets: () => [bulletInto(1, lastLegs)] },
          ),
        ),
        ...ticks(
          Math.ceil(ZOMBIE_KINDS.Boss.dyingMs / FRAME_MS) + 120,
          FRAME_MS,
        ),
        Story.model(current => {
          expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
          expect(current.boss).toEqual(Boss.Absent())
        }),
      )
    },
  )
})

describe('the door preview', () => {
  const isSameImage =
    (shape: Canvas.Shape) =>
    (wanted: Canvas.Shape): boolean =>
      shape._tag === 'Image' &&
      wanted._tag === 'Image' &&
      shape.src === wanted.src

  const containsShapes = (
    shapes: ReadonlyArray<Canvas.Shape>,
    wanted: ReadonlyArray<Canvas.Shape>,
  ): boolean =>
    Array.some(
      shapes,
      shape =>
        Array.some(wanted, isSameImage(shape)) ||
        (shape._tag === 'Group' &&
          (shape.shapes === wanted || containsShapes(shape.shapes, wanted))),
    )

  const preparing = (wave: number, boss: Boss): Model => {
    const [rngState, spawns] = rollSpawns(newPlayerReady.rngState, wave)
    return modifyFields(newPlayerReady, {
      rngState: () => rngState,
      phase: () =>
        Phase.Preparation({
          wave,
          remainingMs: 15_000,
          durationMs: 20_000,
          spawns,
        }),
      boss: () => boss,
    })
  }

  test('marks the boss at its door on the last wave and nowhere else', () => {
    const withBoss = preparing(
      FINAL_WAVE,
      Boss.Waiting({
        door: 'South',
        waitBelow: 20,
        hp: BOSS_HP,
        guestHpScale: 1,
      }),
    )
    const without = preparing(7, Boss.Absent())
    expect(
      containsShapes(
        wavePreviewShapes(withBoss, cameraOf(withBoss)),
        BOSS_ICON,
      ),
    ).toBe(true)
    expect(
      containsShapes(wavePreviewShapes(without, cameraOf(without)), BOSS_ICON),
    ).toBe(false)
  })
})

describe('determinism', () => {
  it.effect('the same seed plays the same charges, spits, and belches', () =>
    Effect.gen(function* () {
      // NOTE: the fight in the dining room's wide aisle north of the table
      // (rows 7 to 9), where a charge's lane has room on both sides.
      const AISLE_Y = 85
      const start = (seed: number): Model =>
        modifyFields(
          withPlayerAt(
            inWave(
              FINAL_WAVE,
              Array.makeBy(4, index => spawnAt(index * 900, index)),
              fightingWith(BossMove.Stalking({ cooldownMs: 0 }), {
                belchMs: 0,
              }),
              [
                modifyFields(bossAt(CENTER_X + 120, AISLE_Y), {
                  speed: () => 10,
                }),
              ],
            ),
            CENTER_X,
            AISLE_Y,
          ),
          { rngState: () => seed },
        )
      // NOTE: the fight's last Model and every frame's event tags, gathered
      // in an array only this Story fills.
      const play = (seed: number) =>
        Effect.suspend(() => {
          const tags: Array<GameEvent['_tag']> = []
          return Story.story(
            APPLICATION,
            Story.given(start(seed)),
            ...Array.flatMap(ticks(700, FRAME_MS), frame => [
              frame,
              Story.model((current: Model) => {
                tags.push(...Array.map(current.frameEvents, ({ _tag }) => _tag))
              }),
            ]),
          ).pipe(Effect.map(end => ({ end, tags })))
        })
      const first = yield* play(5)
      const second = yield* play(5)
      expect(first.tags).toContain('BossRushed')
      expect(first.tags).toContain('BossBelched')
      expect(second.tags).toEqual(first.tags)
      expect(second.end).toEqual(first.end)
    }),
  )

  it.effect('the same seed and the same frames play the same boss fight', () =>
    Effect.gen(function* () {
      const start = (seed: number): Model =>
        modifyFields(
          inWave(
            FINAL_WAVE,
            Array.makeBy(6, index => spawnAt(index * 300, index)),
            Boss.Waiting({
              door: 'East',
              waitBelow: 4,
              hp: BOSS_HP,
              guestHpScale: 1,
            }),
          ),
          {
            rngState: () => seed,
            mode: () => RunMode.Campaign(),
          },
        )
      const finish = (seed: number) =>
        Story.story(
          APPLICATION,
          Story.given(start(seed)),
          ...ticks(600, FRAME_MS),
        )
      const first = yield* finish(9)
      const second = yield* finish(9)
      expect(Boss.isAnyOf(['Fighting'])(first.boss)).toBe(true)
      expect(second).toEqual(first)
    }),
  )
})
