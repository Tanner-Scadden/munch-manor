import { Array, Effect } from 'effect'
import { Story } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'

import { BossMove, GameEvent, Glob, type Model } from '../../../app/model'
import { PLAYER_MAX_HP } from '../../../shared/constants'
import { APPLICATION, FRAME_MS, tick, ticks } from '../../../test/testing'
import { focusOf } from '../../party/party'
import { FINAL_WAVE } from '../../waves/wavePlans'
import { BOSS_RULES } from '../bossRules'
import { ZOMBIE_KINDS, scaledHp } from '../zombies'
import {
  BOSS_HP,
  CENTER_X,
  CENTER_Y,
  bossAt,
  bossWithHpAt,
  eventsTagged,
  fightOf,
  fightingWith,
  inWave,
  spawnAt,
  sturdy,
} from './boss.fixture'

// Uncle Chunk's second phase: at half health he roars, party crashers pour
// in through the doors, and he fights harder: a wide belly slam up close,
// plates thrown three at a time, and a belch of three guests.

const framesOf = (ms: number): number => Math.ceil(ms / FRAME_MS)

const ready = BossMove.Stalking({ cooldownMs: 0 })

const crashersIn = (current: Model) =>
  Array.filter(current.zombies, ({ kind }) => kind !== 'Boss')

describe('half health', () => {
  const quiet = BossMove.Stalking({ cooldownMs: 60_000 })
  const half = Math.floor(BOSS_HP * BOSS_RULES.enrageShare)

  it.effect(
    'his roar calls party crashers through the doors, at the guests scale',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          inWave(
            FINAL_WAVE,
            [spawnAt(1e9, 0)],
            fightingWith(quiet, { guestHpScale: 2 }),
            [bossWithHpAt(half, CENTER_X + 60, CENTER_Y)],
          ),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(fightOf(current).mood).toBe('Enraged')
          const crashers = crashersIn(current)
          expect(crashers).toHaveLength(BOSS_RULES.crashers)
          expect(
            Array.map(Array.take(crashers, 2), ({ kind }) => kind),
          ).toEqual(['Shambler', 'Runner'])
          expect(
            Array.every(
              crashers,
              ({ kind, maxHp }) => maxHp === scaledHp(ZOMBIE_KINDS[kind].hp, 2),
            ),
          ).toBe(true)
        }),
        tick(FRAME_MS),
        Story.model(current => {
          expect(crashersIn(current)).toHaveLength(BOSS_RULES.crashers)
        }),
      ),
  )

  it.effect('above half health nobody crashes the party', () =>
    Story.story(
      APPLICATION,
      Story.given(
        inWave(FINAL_WAVE, [spawnAt(1e9, 0)], fightingWith(quiet, {}), [
          bossWithHpAt(half + 1, CENTER_X + 60, CENTER_Y),
        ]),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        expect(fightOf(current).mood).toBe('Calm')
        expect(crashersIn(current)).toEqual([])
      }),
    ),
  )
})

describe('the belly slam', () => {
  // NOTE: past the stomp's reach and inside the slam's.
  const SLAM_X = CENTER_X + 52

  it.effect('enraged, he winds up a slam where a calm Chunk would wait', () =>
    Effect.gen(function* () {
      const startOf = (mood: 'Calm' | 'Enraged') =>
        inWave(FINAL_WAVE, [spawnAt(1e9, 0)], fightingWith(ready, { mood }), [
          bossAt(SLAM_X, CENTER_Y),
        ])
      yield* Story.story(
        APPLICATION,
        Story.given(startOf('Calm')),
        tick(FRAME_MS),
        Story.model(current => {
          expect(fightOf(current).move._tag).toBe('Stalking')
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(startOf('Enraged')),
        tick(FRAME_MS),
        Story.model(current => {
          expect(fightOf(current).move).toEqual(
            BossMove.WindingUp({
              attack: 'Slam',
              remainingMs: BOSS_RULES.windUpMs.Slam,
              durationMs: BOSS_RULES.windUpMs.Slam,
            }),
          )
          expect(
            Array.map(
              eventsTagged(current.frameEvents, 'BossWoundUp'),
              event =>
                GameEvent.isAnyOf(['BossWoundUp'])(event) ? event.attack : '',
            ),
          ).toEqual(['Slam'])
        }),
      )
    }),
  )

  it.effect('it lands wide and hard, past where a stomp reaches', () =>
    Story.story(
      APPLICATION,
      Story.given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fightingWith(
            BossMove.WindingUp({
              attack: 'Slam',
              remainingMs: 10,
              durationMs: BOSS_RULES.windUpMs.Slam,
            }),
            { mood: 'Enraged' },
          ),
          [bossAt(SLAM_X, CENTER_Y)],
        ),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).player.hp).toBe(
          PLAYER_MAX_HP - BOSS_RULES.slamDamage,
        )
        expect(focusOf(current).player.knockback.x).toBeLessThan(0)
        expect(eventsTagged(current.frameEvents, 'BossStomped')).toEqual([
          GameEvent.BossStomped({
            x: SLAM_X,
            y: CENTER_Y,
            radius: BOSS_RULES.slamRadius,
          }),
        ])
        expect(fightOf(current).move._tag).toBe('Recovering')
      }),
    ),
  )
})

describe('his raging throws and belches', () => {
  const FAR_X = CENTER_X + 90
  // NOTE: inside the belch's middle distance and outside the slam's reach.
  const NEAR_X = CENTER_X + 68

  const flyingGlobs = (current: Model) =>
    Array.filter(fightOf(current).globs, Glob.isAnyOf(['Flying']))

  it.effect('enraged, he throws a volley of three plates, not one', () =>
    Effect.gen(function* () {
      const thrown = (mood: 'Calm' | 'Enraged') =>
        Story.story(
          APPLICATION,
          Story.given(
            sturdy(
              inWave(
                FINAL_WAVE,
                [spawnAt(1e9, 0)],
                fightingWith(ready, { mood, nextFar: 'Spit' }),
                [bossAt(FAR_X, CENTER_Y)],
              ),
            ),
          ),
          ...ticks(framesOf(BOSS_RULES.windUpMs.Spit) + 2, FRAME_MS),
        ).pipe(Effect.map(flyingGlobs))
      const calm = yield* thrown('Calm')
      const raging = yield* thrown('Enraged')
      expect(calm).toHaveLength(1)
      expect(raging).toHaveLength(BOSS_RULES.volleyCount)
      const ys = Array.map(raging, glob =>
        Glob.isAnyOf(['Flying'])(glob) ? glob.to.y : 0,
      )
      expect(new Set(ys).size).toBe(BOSS_RULES.volleyCount)
    }),
  )

  it.effect('enraged, he belches three guests and belches sooner', () =>
    Story.story(
      APPLICATION,
      Story.given(
        sturdy(
          inWave(
            FINAL_WAVE,
            [spawnAt(1e9, 0)],
            fightingWith(ready, { mood: 'Enraged', belchMs: 0 }),
            [bossAt(NEAR_X, CENTER_Y)],
          ),
        ),
      ),
      ...ticks(framesOf(BOSS_RULES.windUpMs.Belch) + 2, FRAME_MS),
      Story.model(current => {
        expect(
          Array.filter(current.zombies, ({ kind }) => kind === 'Shambler'),
        ).toHaveLength(BOSS_RULES.ragedBelchCount)
        expect(fightOf(current).belchMs).toBeLessThan(
          BOSS_RULES.belchEveryMs * BOSS_RULES.ragedBelchScale + 1,
        )
      }),
    ),
  )
})
