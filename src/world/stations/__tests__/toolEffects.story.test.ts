import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import type { Model } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  hidingSpotIn,
  withDareThings,
  withPlayerAt,
  withZombies,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  changeModel,
  eventsOver,
  tagsOf,
  ticks,
  zombieAt,
  zombieOf,
} from '../../../test/testing'
import { DareThingState } from '../../dare/dareSchema'
import { levelOf } from '../../level/arena'
import { CELLAR_ROOM_ID, PARLOUR_ROOM_ID } from '../../level/plan'
import { boxCenter } from '../../level/tileGrid'
import { isSolidAt } from '../../level/tileQueries'
import { heapBoxOf, isHeapDown } from '../../library/stacks'
import { focusOf } from '../../party/party'
import type { Vector, Zombie } from '../../schema/worldSchema'
import { distanceBetween } from '../../step/geometry'
import { TOOL_RULES } from '../toolRules'
import {
  atTool,
  firedAgo,
  houseWave,
  roomBoxOf,
  spotAtTool,
  toolBoxOf,
} from './roomTools.fixture'

// What each room tool does once it fires (src/world/stations/toolRules.ts):
// the gramophone's waltz, the leaning stacks' heap, the revolving shelf's
// spin, the barrel's roll, the bulb's light, and the soup pot's spill.

const FRAME_MS = FIXED_STEP_MS
const WALK_SPEED = 30

const onlyZombie = (model: Model): Zombie =>
  Option.getOrThrow(Array.head(model.zombies))

const isDazed = (zombie: Zombie): boolean => zombie.action._tag === 'Dazed'

// NOTE: where the one zombie stands after `count` frames from `model`.
const zombieAfter = (model: Model, count: number) =>
  Story.story(APPLICATION, Story.given(model), ...ticks(count, FRAME_MS)).pipe(
    Effect.map(onlyZombie),
  )

describe('the gramophone', () => {
  const center = boxCenter(roomBoxOf(houseWave, PARLOUR_ROOM_ID))
  const dancer = zombieAt(1, center.x, center.y, { speed: WALK_SPEED })
  const crowd = withZombies(houseWave, [dancer])

  it.effect(
    'a Groaner in the parlour waltzes on the spot instead of chasing',
    () =>
      Effect.gen(function* () {
        const chasing = yield* zombieAfter(crowd, 90)
        const waltzing = yield* zombieAfter(
          firedAgo(crowd, 'Gramophone', 0),
          90,
        )
        expect(distanceBetween(chasing, center)).toBeGreaterThan(30)
        expect(distanceBetween(waltzing, center)).toBeLessThan(12)
      }),
  )

  it.effect('a Hotfoot keeps chasing through the music', () =>
    Effect.gen(function* () {
      const runner = zombieOf('Runner', 1, center.x, center.y, {
        speed: WALK_SPEED,
      })
      const after = yield* zombieAfter(
        firedAgo(withZombies(houseWave, [runner]), 'Gramophone', 0),
        90,
      )
      expect(distanceBetween(after, center)).toBeGreaterThan(30)
    }),
  )

  it.effect('the music stops once its time is up', () =>
    Effect.gen(function* () {
      const after = yield* zombieAfter(
        firedAgo(crowd, 'Gramophone', TOOL_RULES.Gramophone.activeMs),
        90,
      )
      expect(distanceBetween(after, center)).toBeGreaterThan(30)
    }),
  )
})

describe('the leaning stacks', () => {
  const heap = Option.getOrThrow(heapBoxOf(levelOf(houseWave), 'NorthStack'))
  const inHeap = boxCenter(heap)
  const setUpTicks = Math.ceil(TOOL_RULES.NorthStack.setUpMs / FRAME_MS) + 2
  const under = withZombies(atTool(houseWave, 'NorthStack'), [
    zombieOf('Tank', 1, inHeap.x, inHeap.y),
  ])

  it.effect(
    'topple: the heap crushes the zombies under it and blocks the aisle',
    () =>
      Story.story(
        APPLICATION,
        Story.given(under),
        ...ticks(setUpTicks, FRAME_MS),
        Story.model(current => {
          expect(isHeapDown(current, 'NorthStack')).toBe(true)
          expect(isSolidAt(levelOf(current), inHeap)).toBe(true)
          expect(Array.every(current.zombies, ({ hp }) => hp <= 0)).toBe(true)
        }),
      ),
  )

  it.effect('the books are shelved again once their time is up', () =>
    Story.story(
      APPLICATION,
      Story.given(under),
      ...ticks(setUpTicks, FRAME_MS),
      changeModel(model =>
        firedAgo(model, 'NorthStack', TOOL_RULES.NorthStack.activeMs),
      ),
      ...ticks(1, FRAME_MS),
      Story.model(current => {
        expect(isHeapDown(current, 'NorthStack')).toBe(false)
        expect(isSolidAt(levelOf(current), inHeap)).toBe(false)
      }),
    ),
  )
})

describe('the revolving shelf', () => {
  const shelf = toolBoxOf(houseWave, 'Shelf')
  const wall = boxCenter(shelf)
  const spot = spotAtTool(houseWave, 'Shelf')
  const setUpTicks = Math.ceil(TOOL_RULES.Shelf.setUpMs / FRAME_MS) + 2

  it.effect(
    'spins its worker through the wall and flings the zombies near it',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          withZombies(atTool(houseWave, 'Shelf'), [
            zombieAt(1, spot.x, spot.y + 22),
          ]),
        ),
        ...ticks(setUpTicks, FRAME_MS),
        Story.model(current => {
          expect(current.stations.Shelf.timesWorked).toBe(1)
          const { x } = focusOf(current).player
          expect(Math.sign(x - wall.x)).toBe(-Math.sign(spot.x - wall.x))
          const zombie = onlyZombie(current)
          expect(isDazed(zombie)).toBe(true)
          expect(distanceBetween(zombie, wall)).toBeGreaterThan(
            distanceBetween({ x: spot.x, y: spot.y + 22 }, wall),
          )
        }),
      ),
  )
})

describe('the barrels', () => {
  const barrels = toolBoxOf(houseWave, 'Barrels')
  const lane: Vector = { x: boxCenter(barrels).x - 30, y: barrels.top }
  const sturdy = { hp: 10, maxHp: 10 }

  it.effect(
    'a barrel rolls down the lane and bowls over the zombies in it',
    () =>
      Effect.gen(function* () {
        const bowled = yield* zombieAfter(
          firedAgo(
            withZombies(houseWave, [zombieAt(1, lane.x, lane.y, sturdy)]),
            'Barrels',
            0,
          ),
          20,
        )
        expect(bowled.hp).toBe(sturdy.hp - TOOL_RULES.Barrels.damage)
        expect(isDazed(bowled)).toBe(true)
      }),
  )

  it.effect('a zombie off the lane is missed', () =>
    Effect.gen(function* () {
      const missed = yield* zombieAfter(
        firedAgo(
          withZombies(houseWave, [zombieAt(1, lane.x, lane.y + 30, sturdy)]),
          'Barrels',
          0,
        ),
        20,
      )
      expect(missed.hp).toBe(sturdy.hp)
      expect(isDazed(missed)).toBe(false)
    }),
  )
})

describe('the bulb chain', () => {
  const cellar = boxCenter(roomBoxOf(houseWave, CELLAR_ROOM_ID))
  const walker = withZombies(houseWave, [
    zombieAt(1, cellar.x, cellar.y, { speed: WALK_SPEED }),
  ])

  it.effect('in the dark, zombies in the cellar walk faster', () =>
    Effect.gen(function* () {
      const dark = yield* zombieAfter(walker, 30)
      const lit = yield* zombieAfter(firedAgo(walker, 'Bulb', 0), 30)
      const darkStep = distanceBetween(dark, cellar)
      const litStep = distanceBetween(lit, cellar)
      expect(litStep).toBeGreaterThan(0)
      expect(darkStep / litStep).toBeCloseTo(TOOL_RULES.Bulb.darkPace, 1)
    }),
  )

  const thingSpot = hidingSpotIn(levelOf(houseWave), CELLAR_ROOM_ID)
  const onThing = withPlayerAt(
    withDareThings(houseWave, [
      {
        id: 0,
        kind: 'SilverSpoon',
        state: DareThingState.Hidden({ ...thingSpot, workedMs: 0 }),
      },
    ]),
    thingSpot.x,
    thingSpot.y,
  )
  const stateAfter = (model: Model) =>
    Story.story(APPLICATION, Story.given(model), ...ticks(1, FRAME_MS)).pipe(
      Effect.map(({ dareThings }) =>
        Option.map(Array.head(dareThings), ({ state }) => state._tag),
      ),
    )

  it.effect("the cellar's dare thing is found only in the light", () =>
    Effect.gen(function* () {
      const inTheDark = yield* stateAfter(onThing)
      const inTheLight = yield* stateAfter(firedAgo(onThing, 'Bulb', 0))
      expect(inTheDark).toEqual(Option.some('Hidden'))
      expect(inTheLight).toEqual(Option.some('Found'))
    }),
  )
})

describe('the soup pot', () => {
  const pot = boxCenter(toolBoxOf(houseWave, 'SoupPot'))
  const puddle = { x: pot.x, y: pot.y + TOOL_RULES.SoupPot.spillDownPx }
  const edge = TOOL_RULES.SoupPot.radiusPx
  // NOTE: a zombie east of the puddle, on dry floor, walking west through
  // it at the player on its far side. The kitchen's old soup lies west of
  // the pot.
  const crossing = withPlayerAt(
    withZombies(houseWave, [
      zombieAt(1, puddle.x + edge + 4, puddle.y, { speed: WALK_SPEED }),
    ]),
    puddle.x - edge - 30,
    puddle.y,
  )

  it.effect('a zombie that walks into its spill slips', () =>
    Effect.gen(function* () {
      const frames = Array.makeBy(30, () =>
        Message.TickedFrame({ deltaTime: FRAME_MS }),
      )
      const slips = (model: Model) =>
        eventsOver(model, frames).pipe(
          Effect.map(events =>
            Array.filter(tagsOf(events), tag => tag === 'ZombieSlipped'),
          ),
        )
      const spilled = yield* slips(firedAgo(crossing, 'SoupPot', 0))
      const dry = yield* slips(crossing)
      expect(spilled).toHaveLength(1)
      expect(dry).toEqual([])
    }),
  )
})
