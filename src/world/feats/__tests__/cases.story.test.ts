import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { type Bullet, type Model, Pierce } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  AT_CASE,
  atCase,
  atOpenedCase,
  crewInWave,
  placeSeat,
  playingModel,
  withFeatsOf,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  HOLD_TICKS,
  holdEnter,
  holdFire,
  maybeSpareGun,
  releaseFire,
  tick,
  zombieOf,
} from '../../../test/testing'
import { isCarrying } from '../../gear/weapons'
import { openExitIn } from '../../level/arena'
import { KITCHEN_EXIT } from '../../level/exits'
import { focusOf, maybePlayerAt } from '../../party/party'
import type { World } from '../../schema/world'
import {
  CaseState,
  type DisplayCase,
  Feat,
  GameEvent,
} from '../../schema/worldSchema'
import { offersOf } from '../../shop/purchase'
import { stepWorld } from '../../step/stepWorld'
import { CASE_SPOTS, rollCases, takeCase } from '../cases'
import { goalOf } from '../feats'

// Display cases (src/world/feats/cases.ts): each run rolls its prizes and
// feats over the case spots; a case springs open for whoever first does its
// feat, and only they take what it holds.

const FRAME_MS = FIXED_STEP_MS

const ONE_KILL = Feat.Kills({ count: 1 })

const caseOffered = (model: World, slot: number): boolean =>
  Array.some(offersOf(model, slot), ({ target }) => target._tag === 'Case')

const firstCase = (world: World): DisplayCase =>
  Option.getOrThrow(Array.head(world.cases))

describe('the roll', () => {
  test('the same seed and difficulty roll the same cases, and seeds differ', () => {
    expect(rollCases(7, 'Normal')).toEqual(rollCases(7, 'Normal'))
    const rolls = Array.map(Array.range(1, 20), seed =>
      Array.join(
        Array.map(
          rollCases(seed, 'Normal'),
          ({ prize, feat }) => `${prize}:${feat._tag}:${goalOf(feat)}`,
        ),
        ',',
      ),
    )
    expect(Array.dedupe(rolls).length).toBeGreaterThan(5)
  })

  test('every prize sits in a case, and every case starts locked', () => {
    Array.forEach(Array.range(1, 30), seed => {
      const cases = rollCases(seed, 'Hard')
      expect(cases).toHaveLength(CASE_SPOTS.length)
      expect(
        Array.sort(
          Array.dedupe(Array.map(cases, ({ prize }) => prize)),
          (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
        ),
      ).toEqual(['Blunderbuss', 'LaserSight', 'Rifle', 'Shotgun', 'Smg'])
      expect(
        Array.dedupe(
          Array.map(
            Array.filter(
              cases,
              ({ spot }) => CASE_SPOTS[spot]?.isNear === true,
            ),
            ({ prize }) => prize,
          ),
        ),
      ).toHaveLength(3)
      expect(
        Array.every(cases, ({ state }) => CaseState.isAnyOf(['Locked'])(state)),
      ).toBe(true)
    })
  })

  test('the two cases by the start never ask the same feat', () => {
    Array.forEach(Array.range(1, 30), seed => {
      const [first, second] = rollCases(seed, 'Normal')
      expect(first?.feat).not.toEqual(second?.feat)
    })
  })

  test('easier difficulties ask fewer kills and never the hardest feats', () => {
    const feats = (difficulty: 'Easy' | 'Nightmare') =>
      Array.flatMap(Array.range(1, 60), seed =>
        Array.map(rollCases(seed, difficulty), ({ feat }) => feat),
      )
    const tags = (difficulty: 'Easy' | 'Nightmare') =>
      Array.dedupe(Array.map(feats(difficulty), ({ _tag }) => _tag))
    expect(tags('Easy')).not.toContain('NoHitWave')
    expect(tags('Nightmare')).toContain('NoHitWave')
    const killGoal = (difficulty: 'Easy' | 'Nightmare') =>
      Array.findFirst(feats(difficulty), Feat.isAnyOf(['Kills']))
    expect(
      Option.map(killGoal('Easy'), feat =>
        Feat.isAnyOf(['Kills'])(feat) ? feat.count : 0,
      ),
    ).not.toEqual(
      Option.map(killGoal('Nightmare'), feat =>
        Feat.isAnyOf(['Kills'])(feat) ? feat.count : 0,
      ),
    )
  })
})

// NOTE: a 1-hp Groaner just east of the player at the case, standing still.
const besideCase = zombieOf('Shambler', 900, AT_CASE.x + 10, AT_CASE.y, {
  hp: 1,
  speed: 0,
})

const lockedCase = (model: Model, feat: Feat = ONE_KILL): Model =>
  modifyFields(atCase(model, 'Smg', CaseState.Locked(), feat), {
    zombies: () => [besideCase],
  })

describe('one player', () => {
  it.effect(
    'its feat done, the case springs open for the player, who holds to take the gun',
    () =>
      Story.story(
        APPLICATION,
        Story.given(lockedCase(playingModel)),
        Story.model(current => {
          expect(caseOffered(current, 0)).toBe(false)
        }),
        holdFire,
        tick(FRAME_MS),
        Story.model(current => {
          expect(firstCase(current).state).toEqual(CaseState.Opened({ by: 0 }))
          expect(
            Array.some(current.frameEvents, GameEvent.isAnyOf(['CaseOpened'])),
          ).toBe(true)
          expect(caseOffered(current, 0)).toBe(true)
        }),
        releaseFire,
        // NOTE: the kill's hit-stop holds the world a few frames first.
        ...holdEnter(HOLD_TICKS + 10),
        Story.model(current => {
          expect(firstCase(current).state).toEqual(CaseState.Emptied({ by: 0 }))
          expect(
            Option.map(
              maybeSpareGun(focusOf(current).player.arsenal),
              gun => gun.kind,
            ),
          ).toEqual(Option.some('Smg'))
          expect(caseOffered(current, 0)).toBe(false)
        }),
      ),
  )

  it.effect('short of its feat, the case stays locked', () =>
    Story.story(
      APPLICATION,
      Story.given(lockedCase(playingModel, Feat.Kills({ count: 2 }))),
      holdFire,
      tick(FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).feats.kills).toBe(1)
        expect(firstCase(current).state).toEqual(CaseState.Locked())
      }),
    ),
  )

  it.effect('the Laser Sight case fits the sight', () =>
    Story.story(
      APPLICATION,
      Story.given(atOpenedCase(playingModel, 'LaserSight')),
      ...holdEnter(HOLD_TICKS),
      Story.model(current => {
        expect(focusOf(current).laserSight).toBe('Fitted')
        expect(isCarrying(focusOf(current).player, 'Smg')).toBe(false)
      }),
    ),
  )

  it.effect('a case in the kitchen waits for the kitchen to open', () => {
    const inKitchen = withFeatsOf(
      modifyFields(playingModel, {
        cases: () => [
          {
            id: 3,
            spot: 3,
            prize: 'Shotgun',
            feat: ONE_KILL,
            state: CaseState.Locked(),
          },
        ],
      }),
      tally => modifyFields(tally, { kills: () => 1 }),
    )
    return Effect.gen(function* () {
      yield* Story.story(
        APPLICATION,
        Story.given(inKitchen),
        tick(FRAME_MS),
        Story.model(current => {
          expect(firstCase(current).state).toEqual(CaseState.Locked())
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(
          modifyFields(inKitchen, {
            level: level => openExitIn(level, KITCHEN_EXIT),
          }),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(firstCase(current).state).toEqual(CaseState.Opened({ by: 0 }))
        }),
      )
    })
  })
})

// CO-OP

const crewBullet = (id: number, shooter: number, x: number, y: number) =>
  ({
    id,
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
    shooter,
  }) satisfies Bullet

describe('co-op', () => {
  test('a case opens for whoever does its feat first, and only they take its prize', () => {
    const crew = modifyFields(
      placeSeat(placeSeat(crewInWave(2), 0, AT_CASE.x, AT_CASE.y), 1, 40, 150),
      {
        cases: () => [
          {
            id: 0,
            spot: 0,
            prize: 'Smg',
            feat: ONE_KILL,
            state: CaseState.Locked(),
          },
        ],
        zombies: () => [
          zombieOf('Shambler', 900, 200, 45, { hp: 1, speed: 0 }),
        ],
        bullets: () => [crewBullet(1, 1, 200, 45)],
      },
    )
    const opened = stepWorld(crew, new Map()).world
    expect(firstCase(opened).state).toEqual(CaseState.Opened({ by: 1 }))
    expect(
      Array.findFirst(opened.frameEvents, GameEvent.isAnyOf(['CaseOpened'])),
    ).toEqual(
      Option.some(
        GameEvent.CaseOpened({
          x: AT_CASE.x,
          y: AT_CASE.y - 8,
          prize: 'Smg',
          opener: 1,
        }),
      ),
    )
    expect(caseOffered(opened, 0)).toBe(false)
    expect(Option.isNone(takeCase(opened, 0, 0))).toBe(true)
    const taken = Option.getOrThrow(takeCase(opened, 1, 0))
    expect(
      isCarrying(Option.getOrThrow(maybePlayerAt(taken, 1)).player, 'Smg'),
    ).toBe(true)
    expect(
      isCarrying(Option.getOrThrow(maybePlayerAt(taken, 0)).player, 'Smg'),
    ).toBe(false)
    expect(firstCase(taken).state).toEqual(CaseState.Emptied({ by: 1 }))
  })
})
