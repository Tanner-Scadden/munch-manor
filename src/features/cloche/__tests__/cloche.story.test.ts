import { Array } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { ClocheLift, type Model, Phase } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  freshRunModel,
  pastTimedBreaks,
  withKeys,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  BELOW_KITCHEN_DOOR,
  HOLD_TICKS,
  press,
  release,
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
    modifyFields(withKeys(pastTimedBreaks(freshRunModel()), keys), {
      level: () => startingLevelFor(arrangement),
      phase: () =>
        Phase.Preparation({
          wave: 3,
          remainingMs: 15_000,
          durationMs: 20_000,
          spawns: [DISTANT_SPAWN],
        }),
    }),
    {
      player: player =>
        modifyFields(player, { x: () => spot.x, y: () => spot.y }),
    },
  )

const TOTAL_TICKS = Math.ceil(CLOCHE_TOTAL_MS / FRAME_MS) + 1

describe('the cloche over the boards', () => {
  it.effect.each(ARRANGEMENTS)(
    'lifts on the room this house rolled behind the west boards: %o',
    arrangement =>
      Story.story(
        APPLICATION,
        Story.given(atBoards(arrangement, BY_WEST_BOARDS, PLENTY)),
        press('Enter'),
        ...ticks(HOLD_TICKS + 2, FRAME_MS),
        release('Enter'),
        Story.model(current => {
          expect(current.level.openExits).toContain(WEST_EXIT)
          expect(ClocheLift.isAnyOf(['Lifting'])(current.clocheLift)).toBe(true)
          if (ClocheLift.isAnyOf(['Lifting'])(current.clocheLift)) {
            expect(current.clocheLift.room).toBe(arrangement.West)
            expect(Math.abs(current.clocheLift.at.x)).toBeLessThan(10)
          }
        }),
        ...ticks(TOTAL_TICKS, FRAME_MS),
        Story.model(current => {
          expect(current.clocheLift).toEqual(ClocheLift.Resting())
        }),
      ),
  )

  it.effect('stays down for the kitchen, which never rolls', () =>
    Story.story(
      APPLICATION,
      Story.given(
        atBoards(Array.headNonEmpty(ARRANGEMENTS), BELOW_KITCHEN_DOOR, PLENTY),
      ),
      press('Enter'),
      ...ticks(HOLD_TICKS + 2, FRAME_MS),
      release('Enter'),
      Story.model(current => {
        expect(current.level.openExits).toContain('Kitchen')
        expect(current.keys.held).toBeLessThan(PLENTY)
        expect(current.clocheLift).toEqual(ClocheLift.Resting())
      }),
    ),
  )
})
