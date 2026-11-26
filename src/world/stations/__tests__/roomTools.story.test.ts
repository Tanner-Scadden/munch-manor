import { Array, Effect } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import type { Model } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { crewInWave, placeSeat, quietWave } from '../../../test/model.fixture'
import {
  checkModel,
  modelAfter,
  steps,
  tagsOf,
  ticks,
} from '../../../test/testing'
import type { StationId } from '../../schema/worldSchema'
import { isWorkingStation } from '../stations'
import { TOOL_RULES } from '../toolRules'
import {
  atTool,
  firedAgo,
  houseWave,
  openHouse,
  spotAtTool,
} from './roomTools.fixture'

const FRAME_MS = FIXED_STEP_MS

const TOOLS: ReadonlyArray<Exclude<StationId, 'Cleat'>> = [
  'Gramophone',
  'NorthStack',
  'SouthStack',
  'Shelf',
  'Barrels',
  'Bulb',
  'SoupPot',
]

const setUpTicks = (id: StationId): number =>
  Math.ceil(TOOL_RULES[id].setUpMs / FRAME_MS) + 2

describe('every room tool', () => {
  Array.forEach(TOOLS, id =>
    it.effect(`${id}: standing at it in a wave sets it up and fires it`, () =>
      modelAfter(
        atTool(houseWave, id),
        steps(
          ticks(Math.floor(setUpTicks(id) / 2), FRAME_MS),
          checkModel(current => {
            expect(current.stations[id].workedMs).toBeGreaterThan(0)
            expect(current.stations[id].timesWorked).toBe(0)
          }),
          ticks(Math.ceil(setUpTicks(id) / 2), FRAME_MS),
          checkModel(current => {
            expect(current.stations[id].timesWorked).toBe(1)
            expect(current.stations[id].cooldownMs).toBeGreaterThan(
              TOOL_RULES[id].cooldownMs - 200,
            )
          }),
        ),
      ),
    ),
  )

  it.effect('says which tool fired, once', () =>
    Effect.gen(function* () {
      const fired: Array<string> = []
      yield* modelAfter(
        atTool(houseWave, 'Bulb'),
        steps(
          ...Array.flatMap(
            Array.makeBy(setUpTicks('Bulb'), () => 0),
            () => [
              ticks(1, FRAME_MS),
              checkModel((current: Model) => {
                fired.push(
                  ...Array.filter(
                    tagsOf(current.frameEvents),
                    tag => tag === 'StationWorked',
                  ),
                )
              }),
            ],
          ),
        ),
      )
      expect(fired).toHaveLength(1)
    }),
  )

  it.effect('a tool in a room still boarded up waits', () =>
    modelAfter(
      atTool(quietWave(4), 'Gramophone'),
      steps(
        ticks(30, FRAME_MS),
        checkModel(current => {
          expect(current.stations.Gramophone.workedMs).toBe(0)
          expect(isWorkingStation(current, 0)).toBe(false)
        }),
      ),
    ),
  )
})

describe('the cooldowns', () => {
  it('are longer for a stronger tool', () => {
    const cooldownOf = (id: StationId): number => TOOL_RULES[id].cooldownMs
    expect(cooldownOf('NorthStack')).toBeGreaterThan(cooldownOf('Gramophone'))
    expect(cooldownOf('Gramophone')).toBeGreaterThan(cooldownOf('Bulb'))
    expect(cooldownOf('Bulb')).toBeGreaterThan(cooldownOf('SoupPot'))
    expect(cooldownOf('SoupPot')).toBeGreaterThan(cooldownOf('Barrels'))
    expect(cooldownOf('Barrels')).toBeGreaterThan(cooldownOf('Shelf'))
    Array.forEach(TOOLS, id => {
      expect(TOOL_RULES[id].activeMs).toBeLessThan(TOOL_RULES[id].cooldownMs)
    })
  })

  it.effect('a tool cooling down is not worked until it is ready again', () =>
    modelAfter(
      atTool(
        firedAgo(houseWave, 'SoupPot', TOOL_RULES.SoupPot.cooldownMs - 500),
        'SoupPot',
      ),
      steps(
        ticks(20, FRAME_MS),
        checkModel(current => {
          expect(current.stations.SoupPot.workedMs).toBe(0)
          expect(current.stations.SoupPot.cooldownMs).toBeGreaterThan(0)
        }),
        ticks(30, FRAME_MS),
        checkModel(current => {
          expect(current.stations.SoupPot.cooldownMs).toBe(0)
          expect(current.stations.SoupPot.workedMs).toBeGreaterThan(0)
        }),
      ),
    ),
  )

  it.effect('each tool keeps its own clock', () =>
    modelAfter(
      atTool(firedAgo(houseWave, 'Barrels', 1000), 'Bulb'),
      steps(
        ticks(setUpTicks('Bulb'), FRAME_MS),
        checkModel(current => {
          expect(current.stations.Bulb.timesWorked).toBe(1)
          expect(current.stations.Barrels.timesWorked).toBe(1)
          expect(current.stations.Barrels.cooldownMs).toBeLessThan(
            TOOL_RULES.Barrels.cooldownMs - 1000,
          )
        }),
      ),
    ),
  )
})

describe('a room tool in co-op', () => {
  const crewAt = (count: number): Model => {
    const spot = spotAtTool(houseWave, 'Gramophone')
    const crew = openHouse(crewInWave(2))
    return count === 2
      ? placeSeat(placeSeat(crew, 0, spot.x - 2, spot.y), 1, spot.x + 2, spot.y)
      : placeSeat(crew, 0, spot.x, spot.y)
  }

  it.effect('each player working adds their own share', () =>
    Effect.gen(function* () {
      const after = (model: Model) =>
        modelAfter(model, ticks(30, FRAME_MS)).pipe(
          Effect.map(({ stations }) => stations.Gramophone.workedMs),
        )
      const one = yield* after(crewAt(1))
      const two = yield* after(crewAt(2))
      expect(one).toBeGreaterThan(0)
      expect(two).toBeCloseTo(one * 2, 0)
    }),
  )

  it.effect('the crew shares one tool: it fires once for both', () =>
    modelAfter(
      crewAt(2),
      steps(
        ticks(Math.ceil(setUpTicks('Gramophone') / 2) + 2, FRAME_MS),
        checkModel(current => {
          expect(current.stations.Gramophone.timesWorked).toBe(1)
        }),
      ),
    ),
  )
})
