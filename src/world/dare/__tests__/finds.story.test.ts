import { Array, Effect } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import type { Model } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  crewInWave,
  hidingSpotIn,
  placeSeat,
  quietWave,
  roomOpenIn,
  withDareThings,
  withPlayerAt,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  eventsOver,
  holdFire,
  settleRunCommands,
  tagsOf,
  ticks,
} from '../../../test/testing'
import { levelOf, openExitIn } from '../../level/arena'
import { KITCHEN_EXIT } from '../../level/exits'
import {
  DEFAULT_ARRANGEMENT,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
} from '../../level/plan'
import type { SlotRoomId } from '../../schema/worldSchema'
import { findStyleOf, isWorkingFind } from '../dare'
import { DareThingState } from '../dareSchema'
import { FIND_RULES, type FindStyle } from '../finds'

// Each room finds its thing its own way (src/world/dare/finds.ts): in the
// parlour a still player rummages a trunk about 1 s, in the library works a
// hollow book out about 1 s, in the kitchen hauls the dumbwaiter up 2 s. A
// player at work holds their fire, a step away drains the work, and two
// players work it twice as fast. The dining room still walks onto its thing.

const FRAME_MS = FIXED_STEP_MS

type FindCase = Readonly<{
  room: string
  style: FindStyle
  open: (model: Model) => Model
}>

const openSlotRoom =
  (room: SlotRoomId) =>
  (model: Model): Model =>
    modifyFields(model, {
      level: () => roomOpenIn(DEFAULT_ARRANGEMENT, room),
    })

const openKitchen = (model: Model): Model =>
  modifyFields(model, { level: level => openExitIn(level, KITCHEN_EXIT) })

const CASES: ReadonlyArray<FindCase> = [
  { room: PARLOUR_ROOM_ID, style: 'Rummage', open: openSlotRoom('Parlour') },
  {
    room: LIBRARY_ROOM_ID,
    style: 'HollowBook',
    open: openSlotRoom('Library'),
  },
  { room: KITCHEN_ROOM_ID, style: 'Dumbwaiter', open: openKitchen },
]

const spotOf = (room: string) => hidingSpotIn(levelOf(quietWave(3)), room)

// NOTE: the room open and its thing on its first hiding spot, the player
// standing on it.
const atFind = (findCase: FindCase, base: Model = quietWave(3)): Model => {
  const spot = spotOf(findCase.room)
  return withPlayerAt(
    findCase.open(
      withDareThings(base, [
        {
          id: 0,
          kind: 'SilverSpoon',
          state: DareThingState.Hidden({ ...spot, workedMs: 0 }),
        },
      ]),
    ),
    spot.x,
    spot.y,
  )
}

const stateOf = (model: Model) => model.dareThings[0]?.state

describe('each room finds its own way', () => {
  it.effect('names the style of the room a thing lies in', () =>
    Effect.sync(() => {
      Array.forEach(CASES, findCase => {
        const model = atFind(findCase)
        const [thing] = model.dareThings
        expect(thing && findStyleOf(thing, levelOf(model))).toBe(findCase.style)
      })
    }),
  )

  it.effect(
    'a still player at it works it and is not done before its time, then finds it',
    () =>
      Effect.forEach(CASES, findCase => {
        const workMs = FIND_RULES[findCase.style].workMs
        return Story.story(
          APPLICATION,
          Story.given(atFind(findCase)),
          ...ticks(Math.ceil(workMs / FRAME_MS) - 2, FRAME_MS),
          settleRunCommands,
          Story.model(current => {
            expect(isWorkingFind(current, 0)).toBe(true)
            expect(stateOf(current)?._tag).toBe('Hidden')
          }),
          ...ticks(3, FRAME_MS),
          settleRunCommands,
          Story.model(current => {
            expect(stateOf(current)).toEqual(DareThingState.Found({ slot: 0 }))
            expect(isWorkingFind(current, 0)).toBe(false)
          }),
        )
      }),
  )

  it.effect('says so once, with DareFound, as it is found', () =>
    Effect.gen(function* () {
      const findCase = CASES[0] ?? { room: '', style: 'Walk', open: m => m }
      const events = yield* eventsOver(
        atFind(findCase),
        Array.makeBy(Math.ceil(FIND_RULES.Rummage.workMs / FRAME_MS) + 20, () =>
          Message.TickedFrame({ deltaTime: FRAME_MS }),
        ),
      )
      expect(Array.filter(tagsOf(events), tag => tag === 'DareFound')).toEqual([
        'DareFound',
      ])
    }),
  )

  it.effect('a player at work holds their fire', () =>
    Effect.forEach(CASES, findCase =>
      Story.story(
        APPLICATION,
        Story.given(atFind(findCase)),
        holdFire,
        ...ticks(20, FRAME_MS),
        settleRunCommands,
        Story.model(current => {
          expect(isWorkingFind(current, 0)).toBe(true)
          expect(current.bullets).toEqual([])
        }),
      ),
    ),
  )

  it.effect('a step away drains the work, and the thing stays hidden', () =>
    Effect.gen(function* () {
      const findCase = CASES[2] ?? { room: '', style: 'Walk', open: m => m }
      const spot = spotOf(findCase.room)
      const worked = yield* Story.story(
        APPLICATION,
        Story.given(atFind(findCase)),
        ...ticks(60, FRAME_MS),
        settleRunCommands,
      )
      const away = withPlayerAt(worked, spot.x + 40, spot.y)
      const drained = yield* Story.story(
        APPLICATION,
        Story.given(away),
        ...ticks(60, FRAME_MS),
        settleRunCommands,
      )
      const workedMsOf = (model: Model): number => {
        const state = stateOf(model)
        return state !== undefined && DareThingState.guards.Hidden(state)
          ? state.workedMs
          : -1
      }
      expect(workedMsOf(worked)).toBeGreaterThan(900)
      expect(workedMsOf(drained)).toBeLessThan(workedMsOf(worked))
      expect(workedMsOf(drained)).toBeGreaterThan(0)
    }),
  )

  it.effect('a shut room keeps its thing: no work behind the boards', () =>
    Effect.gen(function* () {
      const findCase = CASES[0] ?? { room: '', style: 'Walk', open: m => m }
      const shut = atFind({ ...findCase, open: model => model })
      const after = yield* Story.story(
        APPLICATION,
        Story.given(shut),
        ...ticks(80, FRAME_MS),
        settleRunCommands,
      )
      expect(isWorkingFind(after, 0)).toBe(false)
      expect(stateOf(after)).toEqual(
        DareThingState.Hidden({ ...spotOf(findCase.room), workedMs: 0 }),
      )
    }),
  )
})

describe('a find in co-op', () => {
  const kitchen = CASES[2] ?? { room: '', style: 'Walk', open: m => m }
  const spot = spotOf(kitchen.room)
  const crewAt = (count: number): Model => {
    const crew = atFind(kitchen, crewInWave(2))
    const first = placeSeat(crew, 0, spot.x - 3, spot.y)
    return count === 2
      ? placeSeat(first, 1, spot.x + 3, spot.y)
      : placeSeat(first, 1, spot.x + 80, spot.y)
  }

  it.effect('two players haul the dumbwaiter up in half the time', () =>
    Story.story(
      APPLICATION,
      Story.given(crewAt(2)),
      ...ticks(
        Math.ceil(FIND_RULES.Dumbwaiter.workMs / 2 / FRAME_MS) + 1,
        FRAME_MS,
      ),
      settleRunCommands,
      Story.model(current => {
        expect(stateOf(current)).toEqual(DareThingState.Found({ slot: 0 }))
      }),
    ),
  )

  it.effect('one player alone is not done in that time', () =>
    Story.story(
      APPLICATION,
      Story.given(crewAt(1)),
      ...ticks(
        Math.ceil(FIND_RULES.Dumbwaiter.workMs / 2 / FRAME_MS) + 1,
        FRAME_MS,
      ),
      settleRunCommands,
      Story.model(current => {
        expect(stateOf(current)?._tag).toBe('Hidden')
      }),
    ),
  )
})
