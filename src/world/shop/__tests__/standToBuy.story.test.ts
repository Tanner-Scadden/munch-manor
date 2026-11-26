import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import {
  BreakClock,
  FridgeDoor,
  type Model,
  Phase,
  Purchase,
} from '#app/model.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import {
  DISTANT_SPAWN,
  atFridge,
  freshRunModel,
  fridgeSeededFor,
  pastTimedBreaks,
  withKeys,
} from '#test/model.fixture.ts'
import {
  BELOW_KITCHEN_DOOR,
  HOLD_TICKS,
  STAND_TICKS,
  checkModel,
  holdFire,
  isKitchenOpen,
  modelAfter,
  press,
  release,
  steps,
  ticks,
} from '#test/testing.ts'
import { FRIDGE_RULES } from '#world/fridge/leftovers.ts'
import { isCarrying } from '#world/gear/weapons.ts'
import { EXIT_RULES } from '#world/level/exits.ts'
import { focusOf, modifyFocus } from '#world/party/party.ts'
import { PURCHASE_RULES, holdProgress } from '#world/shop/purchase.ts'

const KEYS = EXIT_RULES.kitchenKeys + 2

const FRAME_MS = FIXED_STEP_MS
const atBoards = (keys: number): Model =>
  modifyFocus(
    UiStruct.evolve(withKeys(pastTimedBreaks(freshRunModel()), keys), {
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
        UiStruct.evolve(player, {
          x: () => BELOW_KITCHEN_DOOR.x,
          y: () => BELOW_KITCHEN_DOOR.y,
        }),
    },
  )

describe('standing still to buy', () => {
  it.effect(
    'standing still at the boards for a second buys them, with the ring filling meanwhile',
    () =>
      modelAfter(
        atBoards(KEYS),
        steps(
          ticks(Math.floor(STAND_TICKS / 2), FRAME_MS),
          checkModel(current => {
            expect(
              Purchase.isAnyOf(['Holding'])(focusOf(current).purchase),
            ).toBe(true)
            expect(holdProgress(focusOf(current).purchase)).toBeGreaterThan(0.4)
            expect(holdProgress(focusOf(current).purchase)).toBeLessThan(0.6)
            expect(isKitchenOpen(current)).toBe(false)
          }),
          ticks(STAND_TICKS - Math.floor(STAND_TICKS / 2), FRAME_MS),
          checkModel(current => {
            expect(isKitchenOpen(current)).toBe(true)
            expect(current.keys.held).toBe(KEYS - EXIT_RULES.kitchenKeys)
          }),
        ),
      ),
  )

  it.effect(
    'the key is faster: half a second of holding buys, half a second of standing does not',
    () =>
      Effect.gen(function* () {
        yield* modelAfter(
          atBoards(KEYS),
          steps(
            ticks(HOLD_TICKS, FRAME_MS),
            checkModel(current => {
              expect(isKitchenOpen(current)).toBe(false)
            }),
          ),
        )
        yield* modelAfter(
          atBoards(KEYS),
          steps(
            press('Enter'),
            ticks(HOLD_TICKS, FRAME_MS),
            checkModel(current => {
              expect(isKitchenOpen(current)).toBe(true)
            }),
          ),
        )
      }),
  )

  it.effect('moving resets the ring, and the next stand starts over', () =>
    modelAfter(
      atBoards(KEYS),
      steps(
        ticks(STAND_TICKS - 10, FRAME_MS),
        press('KeyD'),
        ticks(1, FRAME_MS),
        release('KeyD'),
        press('KeyA'),
        ticks(1, FRAME_MS),
        release('KeyA'),
        checkModel(current => {
          expect(focusOf(current).purchase).toEqual(Purchase.Idle())
        }),
        ticks(STAND_TICKS - 10, FRAME_MS),
        checkModel(current => {
          expect(isKitchenOpen(current)).toBe(false)
          expect(current.keys.held).toBe(KEYS)
        }),
      ),
    ),
  )

  it.effect(
    'firing resets the ring, and standing and shooting never buys',
    () =>
      modelAfter(
        atBoards(KEYS),
        steps(
          ticks(STAND_TICKS - 10, FRAME_MS),
          holdFire,
          ticks(1, FRAME_MS),
          checkModel(current => {
            expect(focusOf(current).purchase).toEqual(Purchase.Idle())
          }),
          ticks(STAND_TICKS * 3, FRAME_MS),
          checkModel(current => {
            expect(isKitchenOpen(current)).toBe(false)
            expect(current.keys.held).toBe(KEYS)
          }),
        ),
      ),
  )

  it.effect('stabbing resets the ring too', () =>
    modelAfter(
      atBoards(KEYS),
      steps(
        ticks(STAND_TICKS - 10, FRAME_MS),
        press('KeyF'),
        holdFire,
        ticks(1, FRAME_MS),
        checkModel(current => {
          expect(focusOf(current).purchase).toEqual(Purchase.Idle())
        }),
        ticks(STAND_TICKS * 2, FRAME_MS),
        checkModel(current => {
          expect(isKitchenOpen(current)).toBe(false)
        }),
      ),
    ),
  )

  it.effect('standing short of the price does nothing: no shake, no buy', () =>
    modelAfter(
      atBoards(EXIT_RULES.kitchenKeys - 1),
      steps(
        ticks(STAND_TICKS * 2, FRAME_MS),
        checkModel(current => {
          expect(focusOf(current).purchase).toEqual(Purchase.Idle())
          expect(isKitchenOpen(current)).toBe(false)
        }),
      ),
    ),
  )

  it.effect('not in the first moments of a wave', () => {
    const waveStart = UiStruct.evolve(atBoards(KEYS), {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    })
    return modelAfter(
      waveStart,
      steps(
        ticks(STAND_TICKS, FRAME_MS),
        checkModel(current => {
          expect(isKitchenOpen(current)).toBe(false)
        }),
        ticks(
          Math.ceil(PURCHASE_RULES.waveGraceMs / FRAME_MS) + STAND_TICKS,
          FRAME_MS,
        ),
        checkModel(current => {
          expect(isKitchenOpen(current)).toBe(true)
        }),
      ),
    )
  })
})

describe('one buy never chains into the next', () => {
  it.effect(
    'a pull by standing does not take its prize until the player moves, then standing takes it',
    () =>
      modelAfter(
        fridgeSeededFor(atFridge(20), 'Cooker'),
        steps(
          ticks(STAND_TICKS, FRAME_MS),
          checkModel(current => {
            expect(FridgeDoor.isAnyOf(['Open'])(current.fridge.door)).toBe(true)
            expect(current.keys.spent).toBe(FRIDGE_RULES.keys)
          }),
          ticks(
            Math.ceil(FRIDGE_RULES.openMs / FRAME_MS) + STAND_TICKS * 2,
            FRAME_MS,
          ),
          checkModel(current => {
            expect(FridgeDoor.isAnyOf(['Offering'])(current.fridge.door)).toBe(
              true,
            )
            expect(focusOf(current).purchase).toEqual(Purchase.Spent())
            expect(current.keys.spent).toBe(FRIDGE_RULES.keys)
          }),
          press('KeyD'),
          ticks(1, FRAME_MS),
          release('KeyD'),
          ticks(STAND_TICKS, FRAME_MS),
          checkModel(current => {
            expect(FridgeDoor.isAnyOf(['Offering'])(current.fridge.door)).toBe(
              false,
            )
            expect(isCarrying(focusOf(current).player, 'Cooker')).toBe(true)
          }),
        ),
      ),
  )

  it.effect('the key still takes the prize at once after a standing pull', () =>
    modelAfter(
      fridgeSeededFor(atFridge(20), 'Cooker'),
      steps(
        ticks(STAND_TICKS, FRAME_MS),
        ticks(Math.ceil(FRIDGE_RULES.openMs / FRAME_MS) + 2, FRAME_MS),
        checkModel(current => {
          expect(focusOf(current).purchase).toEqual(Purchase.Spent())
        }),
        press('Enter'),
        ticks(HOLD_TICKS, FRAME_MS),
        checkModel(current => {
          expect(isCarrying(focusOf(current).player, 'Cooker')).toBe(true)
        }),
      ),
    ),
  )
})
