import { Array, Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { BreakClock, ClocheLift, type Model, Phase } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  freshRunModel,
  pastTimedBreaks,
  withKeys,
} from '../../../test/model.fixture'
import {
  BELOW_KITCHEN_DOOR,
  HOLD_TICKS,
  checkModel,
  press,
  release,
  storyOf,
  ticks,
} from '../../../test/testing'
import { startingLevelFor } from '../../../world/level/arena'
import { EXIT_RULES } from '../../../world/level/exits'
import { ARRANGEMENTS, WEST_EXIT } from '../../../world/level/plan'
import { modifyFocus } from '../../../world/party/party'
import type { Arrangement, Vector } from '../../../world/schema/worldSchema'
import { CLOCHE_TOTAL_MS } from '../clocheReveal'

// NOTE: enough keys for any room's padlock.
const PLENTY = EXIT_RULES.farKeys

// The cloche reveal (src/features/cloche/clocheReveal.ts): the boards to a
// slot come down, and the cloche over the doorway lifts on whichever room
// this run's house rolled in behind them.

const FRAME_MS = FIXED_STEP_MS

// NOTE: in front of the dining room's west boards.
const BY_WEST_BOARDS: Vector = { x: 18, y: 130 }

const atBoards = (
  arrangement: Arrangement,
  spot: Vector,
  keys: number,
): Model =>
  modifyFocus(
    UiStruct.evolve(withKeys(pastTimedBreaks(freshRunModel()), keys), {
      level: () => startingLevelFor(arrangement),
      phase: () =>
        Phase.Preparation({
          clock: BreakClock.Counting(),
          wave: 3,
          remainingMs: 15_000,
          durationMs: 20_000,
          spawns: [DISTANT_SPAWN],
        }),
    }),
    {
      player: player =>
        UiStruct.evolve(player, { x: () => spot.x, y: () => spot.y }),
    },
  )

const TOTAL_TICKS = Math.ceil(CLOCHE_TOTAL_MS / FRAME_MS) + 1

describe('the cloche over the boards', () => {
  it.effect.each(ARRANGEMENTS)(
    'lifts on the room this house rolled behind the west boards: %o',
    arrangement =>
      Effect.gen(function* () {
        const s = yield* storyOf(atBoards(arrangement, BY_WEST_BOARDS, PLENTY))
        s.pipe(
          press('Enter'),
          ticks(HOLD_TICKS + 2, FRAME_MS),
          release('Enter'),
          checkModel(current => {
            expect(current.level.openExits).toContain(WEST_EXIT)
            expect(
              ClocheLift.isAnyOf(['Lifting'])(current.cosmetics.clocheLift),
            ).toBe(true)
            if (ClocheLift.isAnyOf(['Lifting'])(current.cosmetics.clocheLift)) {
              expect(current.cosmetics.clocheLift.room).toBe(arrangement.West)
              expect(Math.abs(current.cosmetics.clocheLift.at.x)).toBeLessThan(
                10,
              )
            }
          }),
          ticks(TOTAL_TICKS, FRAME_MS),
          checkModel(current => {
            expect(current.cosmetics.clocheLift).toEqual(ClocheLift.Resting())
          }),
        )
      }),
  )

  it.effect('stays down for the kitchen, which never rolls', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        atBoards(Array.headNonEmpty(ARRANGEMENTS), BELOW_KITCHEN_DOOR, PLENTY),
      )
      s.pipe(
        press('Enter'),
        ticks(HOLD_TICKS + 2, FRAME_MS),
        release('Enter'),
        checkModel(current => {
          expect(current.level.openExits).toContain('Kitchen')
          expect(current.keys.held).toBeLessThan(PLENTY)
          expect(current.cosmetics.clocheLift).toEqual(ClocheLift.Resting())
        }),
      )
    }),
  )
})
