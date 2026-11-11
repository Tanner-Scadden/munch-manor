import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { type Model, Phase } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  crewInWave,
  hidingSpotIn,
  placeSeat,
  roomOpenIn,
  withDareThings,
  withZombies,
} from '../../../test/model.fixture'
import { APPLICATION, ticks, zombieOf } from '../../../test/testing'
import { DareThingState } from '../../../world/dare/dareSchema'
import { levelOf } from '../../../world/level/arena'
import {
  CELLAR_ROOM_ID,
  DEFAULT_ARRANGEMENT,
  DINING_ROOM_ID,
  LIBRARY_ROOM_ID,
} from '../../../world/level/plan'
import { maybePlayerAt } from '../../../world/party/party'
import type { SlotRoomId } from '../../../world/schema/worldSchema'
import { botInputs } from '../teammateBot'
import { BOT, BREAK } from './bots.fixture'

// A teammate bot searches for the dare's list (src/features/bots/dareSearch.ts),
// the way the balance bot does: it walks to a thing in an open room and
// keeps still to work a find, in the cellar it yanks the bulb's chain
// first, and it never leaves a fight for it. Each test seats one bot in a
// crew of two, the human idle far off.

const QUIET_WAVE = Phase.Wave({
  wave: 3,
  elapsedMs: 0,
  spawns: [DISTANT_SPAWN],
})

// NOTE: a crew of the human and one bot, the room open and the dare's one
// thing lying at its hiding spot.
const searching = (
  phase: Phase,
  room: SlotRoomId,
  roomId: string,
): Readonly<{ model: Model; spot: { x: number; y: number } }> => {
  const opened = modifyFields(crewInWave(2), {
    crewBots: () => [BOT],
    phase: () => phase,
    level: () => roomOpenIn(DEFAULT_ARRANGEMENT, room),
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

// NOTE: the slot that found the one thing, while it is found.
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
    return Story.story(
      APPLICATION,
      Story.given(
        placeSeat(1, spot.x + 40, spot.y + 20)(placeSeat(0, 40, 140)(model)),
      ),
      ...ticks(150, FIXED_STEP_MS),
      Story.model(current => {
        expect(foundBy(current)).toBe(1)
      }),
    )
  })

  it.effect(
    "in a wave it yanks the cellar bulb's chain, then fetches the thing in the light",
    () => {
      const { model } = searching(QUIET_WAVE, 'Cellar', CELLAR_ROOM_ID)
      return Story.story(
        APPLICATION,
        Story.given(placeSeat(1, 820, 110)(placeSeat(0, 40, 140)(model))),
        ...ticks(60, FIXED_STEP_MS),
        Story.model(current => {
          expect(foundBy(current)).toBeUndefined()
        }),
        ...ticks(240, FIXED_STEP_MS),
        Story.model(current => {
          expect(current.stations.Bulb.cooldownMs).toBeGreaterThan(0)
          expect(foundBy(current)).toBe(1)
        }),
      )
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

  // NOTE: the zombie stands past SAFE_PX, so only the fight's priority
  // keeps the bot from the thing.
  it.effect('it does not leave a fight to fetch a thing', () => {
    const { model, spot } = searching(QUIET_WAVE, 'Library', DINING_ROOM_ID)
    const start = { x: spot.x, y: spot.y + 60 }
    return Story.story(
      APPLICATION,
      Story.given(
        withZombies(
          placeSeat(1, start.x, start.y)(placeSeat(0, 300, 200)(model)),
          [
            zombieOf('Shambler', 7, start.x - 70, start.y, {
              speed: 0,
              hp: 40,
            }),
          ],
        ),
      ),
      ...ticks(60, FIXED_STEP_MS),
      Story.model(current => {
        expect(foundBy(current)).toBeUndefined()
        expect(botAt(current).y).toBeCloseTo(start.y, 0)
        expect(
          Option.getOrThrow(maybePlayerAt(current, 1)).seat.shotsFired,
        ).toBeGreaterThan(0)
      }),
    )
  })
})
