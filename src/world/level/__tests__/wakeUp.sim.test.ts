import { Array, Effect } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase } from '../../../app/model'
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
  holdToBuy,
  settleRunCommands,
  ticks,
} from '../../../test/testing'
import { modifyFocus } from '../../party/party'
import { EXIT_RULES } from '../exits'
import { WAKE_RULES, isWakePack } from '../wakeUp'

// A wake-up played out (src/world/level/wakeUp.ts): the kitchen bought open
// mid-wave sends its whole rush in through its own doors within about 11 s.

const fighting: Model = modifyFocus(
  modifyFields(
    withKeys(pastTimedBreaks(freshRunModel()), EXIT_RULES.kitchenKeys + 2),
    {
      phase: () =>
        Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    },
  ),
  {
    player: player =>
      modifyFields(player, {
        x: () => BELOW_KITCHEN_DOOR.x,
        y: () => BELOW_KITCHEN_DOOR.y,
      }),
  },
)

const RUSH_TICKS = Math.ceil((WAKE_RULES.rushMs + 1500) / FIXED_STEP_MS)

describe('a room wakes', () => {
  it.effect('its rush comes in through its own doors', () =>
    Effect.gen(function* () {
      const bought = yield* Story.story(
        APPLICATION,
        Story.given(fighting),
        holdToBuy,
        settleRunCommands,
      )
      const before = bought.zombies.length
      const after = yield* Story.story(
        APPLICATION,
        Story.given(bought),
        ...ticks(RUSH_TICKS, FIXED_STEP_MS),
        settleRunCommands,
      )
      const pending = Phase.isAnyOf(['Wave'])(after.phase)
        ? Array.filter(after.phase.spawns, ({ pack }) => isWakePack(pack))
        : []
      expect(pending).toEqual([])
      expect(after.zombies.length - before).toBeGreaterThanOrEqual(
        WAKE_RULES.count,
      )
    }),
  )
})
