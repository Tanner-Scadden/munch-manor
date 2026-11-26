import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { type Model, Phase } from '#app/model.ts'
import { HuntStep, huntPlan } from '#features/bots/dareSearch.ts'
import { botInputs } from '#features/bots/teammateBot.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import {
  DISTANT_SPAWN,
  crewInWave,
  exitsToRoom,
  hidingSpotIn,
  placeSeat,
  roomOpenIn,
  withDareThings,
  withKeys,
  withZombies,
} from '#test/model.fixture.ts'
import { checkModel, storyOf, ticks, zombieOf } from '#test/testing.ts'
import { DareThingState } from '#world/dare/dareSchema.ts'
import { heldKeys } from '#world/keys/keys.ts'
import { maybeStash, pantrySpotOf } from '#world/kitchen/pantry.ts'
import { levelOf, openExitIn, startingLevelFor } from '#world/level/arena.ts'
import { KITCHEN_EXIT, exitPriceFor } from '#world/level/exits.ts'
import {
  CELLAR_ROOM_ID,
  DEFAULT_ARRANGEMENT,
  DINING_ROOM_ID,
  LIBRARY_ROOM_ID,
} from '#world/level/plan.ts'
import { maybePlayerAt } from '#world/party/party.ts'
import { Pantry, type SlotRoomId } from '#world/schema/worldSchema.ts'

import { BOT, BREAK } from './bots.fixture.ts'

const QUIET_WAVE = Phase.Wave({
  wave: 3,
  elapsedMs: 0,
  spawns: [DISTANT_SPAWN],
})

const searching = (
  phase: Phase,
  room: SlotRoomId,
  roomId: string,
): Readonly<{ model: Model; spot: { x: number; y: number } }> => {
  const opened = UiStruct.evolve(crewInWave(2), {
    phase: () => phase,
    level: () => roomOpenIn(DEFAULT_ARRANGEMENT, room),
    runStart: UiStruct.evolve({ crewBots: () => [BOT] }),
  })
  const spot = hidingSpotIn(levelOf(opened), roomId)
  return {
    spot,
    model: withDareThings(opened, [
      {
        id: 0,
        kind: 'ButlersBell',
        state: DareThingState.Hidden({ ...spot, workedMs: 0 }),
      },
    ]),
  }
}

const foundBy = (current: Model): number | undefined =>
  Option.getOrUndefined(
    Option.flatMap(Array.head(current.dareThings), ({ state }) =>
      DareThingState.matchOrElse(
        state,
        { Found: ({ slot }) => Option.some(slot) },
        () => Option.none<number>(),
      ),
    ),
  )

const botAt = (current: Model) =>
  Option.getOrThrow(maybePlayerAt(current, 1)).player

describe('a bot searches for the list', () => {
  it.effect('in a break it works the library hollow book out', () => {
    const { model, spot } = searching(BREAK, 'Library', LIBRARY_ROOM_ID)
    return Effect.gen(function* () {
      const s = yield* storyOf(
        placeSeat(1, spot.x + 40, spot.y + 20)(placeSeat(0, 40, 140)(model)),
      )
      s.pipe(
        ticks(150, FIXED_STEP_MS),
        checkModel(current => {
          expect(foundBy(current)).toBe(1)
        }),
      )
    })
  })

  it.effect(
    "in a wave it yanks the cellar bulb's chain, then fetches the thing in the light",
    () => {
      const { model } = searching(QUIET_WAVE, 'Cellar', CELLAR_ROOM_ID)
      return Effect.gen(function* () {
        const s = yield* storyOf(
          placeSeat(1, 820, 110)(placeSeat(0, 40, 140)(model)),
        )
        s.pipe(
          ticks(60, FIXED_STEP_MS),
          checkModel(current => {
            expect(foundBy(current)).toBeUndefined()
          }),
          ticks(240, FIXED_STEP_MS),
          checkModel(current => {
            expect(current.stations.Bulb.cooldownMs).toBeGreaterThan(0)
            expect(foundBy(current)).toBe(1)
          }),
        )
      })
    },
  )

  test('in reach of a worked find it keeps still to work it', () => {
    const { model, spot } = searching(BREAK, 'Library', LIBRARY_ROOM_ID)
    const inReach = placeSeat(
      1,
      spot.x + 6,
      spot.y,
    )(placeSeat(0, 40, 140)(model))
    expect(botInputs(inReach, [1]).get(1)?.move).toEqual({ x: 0, y: 0 })
  })

  it.effect('it does not leave a fight to fetch a thing', () => {
    const { model, spot } = searching(QUIET_WAVE, 'Library', DINING_ROOM_ID)
    const start = { x: spot.x, y: spot.y + 60 }
    return Effect.gen(function* () {
      const s = yield* storyOf(
        withZombies(
          placeSeat(1, start.x, start.y)(placeSeat(0, 300, 200)(model)),
          [
            zombieOf('Shambler', 7, start.x - 70, start.y, {
              speed: 0,
              hp: 40,
            }),
          ],
        ),
      )
      s.pipe(
        ticks(60, FIXED_STEP_MS),
        checkModel(current => {
          expect(foundBy(current)).toBeUndefined()
          expect(botAt(current).y).toBeCloseTo(start.y, 0)
          expect(
            Option.getOrThrow(maybePlayerAt(current, 1)).seat.shotsFired,
          ).toBeGreaterThan(0)
        }),
      )
    })
  })
})

describe('a bot runs its errands', () => {
  it.effect("in a break it takes the pantry's goodie", () => {
    const found = UiStruct.evolve(crewInWave(2), {
      phase: () => BREAK,
      level: level => openExitIn(level, KITCHEN_EXIT),
      pantry: () => Pantry.Stocked({ round: BREAK.wave, goodie: 'Key' }),
      runStart: UiStruct.evolve({ crewBots: () => [BOT] }),
    })
    const spot = Option.getOrThrow(pantrySpotOf(levelOf(found)))
    return Effect.gen(function* () {
      const s = yield* storyOf(
        placeSeat(1, spot.x + 30, spot.y + 20)(placeSeat(0, 40, 140)(found)),
      )
      s.pipe(
        ticks(120, FIXED_STEP_MS),
        checkModel(current => {
          expect(Option.isNone(maybeStash(current))).toBe(true)
          expect(heldKeys(current)).toBe(heldKeys(found) + 1)
        }),
      )
    })
  })
})

describe('the hunt plan', () => {
  const ROOMS: ReadonlyArray<SlotRoomId> = ['Parlour', 'Library', 'Cellar']

  const boardedOn = (room: SlotRoomId, keys: number): Model => {
    const shut = UiStruct.evolve(crewInWave(2), {
      phase: () => BREAK,
      level: () => startingLevelFor(DEFAULT_ARRANGEMENT),
    })
    const spot = hidingSpotIn(levelOf(shut), room)
    return withKeys(
      withDareThings(shut, [
        {
          id: 0,
          kind: 'ButlersBell',
          state: DareThingState.Hidden({ ...spot, workedMs: 0 }),
        },
      ]),
      keys,
    )
  }

  const FROM = { x: 40, y: 140 }

  const farRoom = Option.getOrThrow(
    Array.findFirst(
      ROOMS,
      room => exitsToRoom(DEFAULT_ARRANGEMENT, room).length === 2,
    ),
  )

  test('with a thing lying in an open room, it fetches it', () => {
    const { model } = searching(BREAK, 'Library', LIBRARY_ROOM_ID)
    expect(huntPlan(model, FROM)).toEqual(HuntStep.Fetch())
  })

  test('short of the padlock on the way, it saves up what it is short', () => {
    const model = boardedOn(farRoom, 10)
    const [first] = exitsToRoom(DEFAULT_ARRANGEMENT, farRoom)
    expect(huntPlan(model, FROM)).toEqual(
      HuntStep.Save({
        exit: first ?? '',
        short: exitPriceFor(model, first ?? '') - 10,
      }),
    )
  })

  test('with the keys in hand, it opens the nearest boards on the way first', () => {
    const model = boardedOn(farRoom, 200)
    const [first] = exitsToRoom(DEFAULT_ARRANGEMENT, farRoom)
    expect(huntPlan(model, FROM)).toEqual(
      HuntStep.Open({
        exit: first ?? '',
        price: exitPriceFor(model, first ?? ''),
      }),
    )
  })

  test('with the list found, the hunt is done', () => {
    const model = withDareThings(boardedOn(farRoom, 0), [])
    expect(huntPlan(model, FROM)).toEqual(HuntStep.Done())
  })
})
