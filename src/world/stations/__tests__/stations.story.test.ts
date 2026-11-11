import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { GameEvent, type Model } from '../../../app/model'
import { FIXED_STEP_MS, PLAYER_RADIUS } from '../../../shared/constants'
import {
  breakBefore,
  crewInWave,
  placeSeat,
  quietWave,
  withPlayerAt,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  changeModel,
  holdFire,
  press,
  release,
  tick,
  ticks,
} from '../../../test/testing'
import { isChandelierDown } from '../../dining/chandelier'
import { MANOR } from '../../level/arena'
import { CHANDELIER_DROP } from '../../level/plan'
import { STATION_RULES, isWorkingStation, stationBoxOf } from '../stations'

// Work stations (src/world/stations/stations.ts), with the dining room's
// chandelier cleat: a still player beside it in a wave, with the
// chandelier down, works it and holds their fire; about 3 s of work winches
// the chandelier back up, then it cools down. A step away drains it, and
// two players set it up twice as fast.

const FRAME_MS = FIXED_STEP_MS
const CLEAT = STATION_RULES.Cleat
const SET_UP_TICKS = Math.ceil(CLEAT.setUpMs / FRAME_MS)

const CLEAT_BOX = Option.getOrThrow(stationBoxOf(MANOR, 'Cleat'))
// NOTE: the floor just east of the cleat's wall tile.
const AT_CLEAT = {
  x: CLEAT_BOX.right + PLAYER_RADIUS + 1,
  y: (CLEAT_BOX.top + CLEAT_BOX.bottom) / 2,
}
// NOTE: six tiles out from the wall, out of reach.
const AWAY = { x: AT_CLEAT.x + 60, y: AT_CLEAT.y }

const withChandelierDown = (model: Model): Model =>
  modifyFields(model, {
    level: state => modifyFields(state, { dropped: () => [CHANDELIER_DROP] }),
  })

const atCleat = (model: Model): Model =>
  withPlayerAt(model, AT_CLEAT.x, AT_CLEAT.y)

const fallenWave = withChandelierDown(quietWave(2))

const workedOf = (model: Model): number => model.stations.Cleat.workedMs

describe('the chandelier cleat', () => {
  it.effect('standing at it in a wave winches the fallen chandelier up', () =>
    Effect.gen(function* () {
      const events: Array<GameEvent> = []
      yield* Story.story(
        APPLICATION,
        Story.given(atCleat(fallenWave)),
        ...ticks(Math.floor(SET_UP_TICKS / 2), FRAME_MS),
        Story.model(current => {
          expect(isWorkingStation(current, 0)).toBe(true)
          expect(isChandelierDown(current)).toBe(true)
          expect(workedOf(current)).toBeGreaterThan(CLEAT.setUpMs / 3)
        }),
        ...Array.flatMap(
          Array.makeBy(Math.ceil(SET_UP_TICKS / 2) + 1, () => 0),
          () => [
            tick(FRAME_MS),
            Story.model((current: Model) => {
              events.push(
                ...Array.filter(
                  current.frameEvents,
                  GameEvent.guards.StationWorked,
                ),
              )
            }),
          ],
        ),
        Story.model(current => {
          expect(isChandelierDown(current)).toBe(false)
          expect(current.stations.Cleat.timesWorked).toBe(1)
          expect(current.stations.Cleat.cooldownMs).toBeGreaterThan(
            CLEAT.cooldownMs - 200,
          )
          expect(isWorkingStation(current, 0)).toBe(false)
        }),
      )
      expect(events).toHaveLength(1)
    }),
  )

  it.effect('a player at work on it cannot shoot', () =>
    Story.story(
      APPLICATION,
      Story.given(atCleat(fallenWave)),
      holdFire,
      ...ticks(20, FRAME_MS),
      Story.model(current => {
        expect(isWorkingStation(current, 0)).toBe(true)
        expect(current.bullets).toEqual([])
        expect(workedOf(current)).toBeGreaterThan(0)
      }),
    ),
  )

  it.effect('the same player shoots once the chandelier is up', () =>
    Story.story(
      APPLICATION,
      Story.given(atCleat(quietWave(2))),
      holdFire,
      ...ticks(20, FRAME_MS),
      Story.model(current => {
        expect(isWorkingStation(current, 0)).toBe(false)
        expect(current.bullets).not.toEqual([])
      }),
    ),
  )

  it.effect(
    'a step away pauses the work, and it drains while nobody works',
    () =>
      Story.story(
        APPLICATION,
        Story.given(atCleat(fallenWave)),
        ...ticks(Math.floor(SET_UP_TICKS / 2), FRAME_MS),
        Story.model(current => {
          expect(workedOf(current)).toBeGreaterThan(CLEAT.setUpMs / 3)
        }),
        changeModel(model => withPlayerAt(model, AWAY.x, AWAY.y)),
        ...ticks(30, FRAME_MS),
        Story.model(current => {
          expect(isWorkingStation(current, 0)).toBe(false)
          expect(workedOf(current)).toBeLessThan(CLEAT.setUpMs / 2)
          expect(workedOf(current)).toBeGreaterThan(0)
          expect(isChandelierDown(current)).toBe(true)
        }),
        ...ticks(SET_UP_TICKS * 2, FRAME_MS),
        Story.model(current => {
          expect(workedOf(current)).toBe(0)
          expect(isChandelierDown(current)).toBe(true)
        }),
      ),
  )

  it.effect('walking past it works nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(atCleat(fallenWave)),
      press('KeyS'),
      ...ticks(10, FRAME_MS),
      Story.model(current => {
        expect(workedOf(current)).toBe(0)
      }),
      release('KeyS'),
    ),
  )

  it.effect(
    'once it fires it cools down: the chandelier dropped again waits',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          atCleat(
            modifyFields(fallenWave, {
              stations: stations =>
                modifyFields(stations, {
                  Cleat: cleat =>
                    modifyFields(cleat, {
                      cooldownMs: () => 1000,
                      timesWorked: () => 1,
                    }),
                }),
            }),
          ),
        ),
        ...ticks(30, FRAME_MS),
        Story.model(current => {
          expect(isWorkingStation(current, 0)).toBe(false)
          expect(workedOf(current)).toBe(0)
          expect(current.stations.Cleat.cooldownMs).toBeLessThan(1000)
        }),
        ...ticks(40, FRAME_MS),
        Story.model(current => {
          expect(current.stations.Cleat.cooldownMs).toBe(0)
          expect(isWorkingStation(current, 0)).toBe(true)
          expect(workedOf(current)).toBeGreaterThan(0)
        }),
      ),
  )

  it.effect('in a break the cleat waits', () =>
    Story.story(
      APPLICATION,
      Story.given(
        atCleat(
          withChandelierDown(
            modifyFields(quietWave(2), { phase: () => breakBefore(3) }),
          ),
        ),
      ),
      ...ticks(30, FRAME_MS),
      Story.model(current => {
        expect(isWorkingStation(current, 0)).toBe(false)
        expect(workedOf(current)).toBe(0)
      }),
    ),
  )
})

describe('the cleat in co-op', () => {
  // NOTE: two seats side by side at the cleat, both still.
  const pair = (count: number): Model =>
    withChandelierDown(
      count === 2
        ? placeSeat(
            placeSeat(crewInWave(2), 0, AT_CLEAT.x, AT_CLEAT.y - 4),
            1,
            AT_CLEAT.x,
            AT_CLEAT.y + 4,
          )
        : placeSeat(crewInWave(2), 0, AT_CLEAT.x, AT_CLEAT.y),
    )

  it.effect('each player working adds their own share', () =>
    Effect.gen(function* () {
      const after = (model: Model) =>
        Story.story(
          APPLICATION,
          Story.given(model),
          ...ticks(30, FRAME_MS),
        ).pipe(Effect.map(workedOf))
      const one = yield* after(pair(1))
      const two = yield* after(pair(2))
      expect(one).toBeGreaterThan(0)
      expect(two).toBeCloseTo(one * 2, 0)
    }),
  )

  it.effect('two players set it up in half the time', () =>
    Story.story(
      APPLICATION,
      Story.given(pair(2)),
      ...ticks(Math.ceil(SET_UP_TICKS / 2) + 2, FRAME_MS),
      Story.model(current => {
        expect(isChandelierDown(current)).toBe(false)
        expect(current.stations.Cleat.timesWorked).toBe(1)
      }),
    ),
  )
})
