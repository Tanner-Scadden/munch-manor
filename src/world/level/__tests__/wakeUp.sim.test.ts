import { Array, Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase } from '#app/model.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import {
  DISTANT_SPAWN,
  freshRunModel,
  pastTimedBreaks,
  withKeys,
} from '#test/model.fixture.ts'
import {
  BELOW_KITCHEN_DOOR,
  holdToBuy,
  modelAfter,
  settleRunCommands,
  steps,
  ticks,
} from '#test/testing.ts'
import { EXIT_RULES } from '#world/level/exits.ts'
import { WAKE_RULES, isWakePack } from '#world/level/wakeUp.ts'
import { modifyFocus } from '#world/party/party.ts'

const fighting: Model = modifyFocus(
  UiStruct.evolve(
    withKeys(pastTimedBreaks(freshRunModel()), EXIT_RULES.kitchenKeys + 2),
    {
      phase: () =>
        Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    },
  ),
  {
    player: player =>
      UiStruct.evolve(player, {
        x: () => BELOW_KITCHEN_DOOR.x,
        y: () => BELOW_KITCHEN_DOOR.y,
      }),
  },
)

const RUSH_TICKS = Math.ceil((WAKE_RULES.rushMs + 1500) / FIXED_STEP_MS)

describe('a room wakes', () => {
  it.effect('its rush comes in through its own doors', () =>
    Effect.gen(function* () {
      const bought = yield* modelAfter(
        fighting,
        steps(holdToBuy, settleRunCommands),
      )
      const before = bought.zombies.length
      const after = yield* modelAfter(
        bought,
        steps(ticks(RUSH_TICKS, FIXED_STEP_MS), settleRunCommands),
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
