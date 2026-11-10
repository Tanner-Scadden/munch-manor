import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  FridgeDoor,
  type FridgePrize,
  type Model,
  Party,
  Phase,
  Tour,
} from '../../../app/model'
import { forgetTutorial } from '../../../platform/save'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { nextRandom } from '../../../shared/prng'
import {
  AT_FRIDGE,
  atFridgeOnWave,
  freshRunModel,
  withKeys,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  BELOW_KITCHEN_DOOR,
  FRIDGE_OPEN_TICKS,
  type RootSteps,
  holdToBuy,
  ticks,
} from '../../../test/testing'
import { asTutorialDone } from '../../../test/veteran'
import {
  FRIDGE_RULES,
  fridgePriceFor,
  isFridgePrizeWeapon,
  pickPrize,
  prizeWeights,
} from '../../../world/fridge/leftovers'
import { heldKeys } from '../../../world/keys/keys'
import { isKitchenOpen } from '../../../world/kitchen/kitchen'
import { levelOf } from '../../../world/level/arena'
import {
  KITCHEN_EXIT,
  exitKeysOf,
  exitPriceFor,
} from '../../../world/level/exits'
import { focusOf, modifyFocus, soloSeat } from '../../../world/party/party'
import { isKitchenTourOn } from '../../../world/run/tutorialRules'
import { type KitchenStep, kitchenStepOf } from '../kitchenTour'

// NOTE: chapter 2 of the guided tutorial (src/features/onboarding/kitchenTour.ts and
// src/world/run/tutorialRules.ts): in a new save's first timed break the clock holds
// still, the kitchen and the first fridge pull are free, the pull is a
// weapon, and the clock runs again once the fridge has been tried.

const FRAME_MS = FIXED_STEP_MS
const OFFER_FRAMES = Math.ceil(FRIDGE_RULES.offerMs / FRAME_MS) + 2
const BREAK_MS = 15_000

const remainingOf = (current: Model): number =>
  Phase.match(current.phase, {
    Ready: () => 0,
    Preparation: ({ remainingMs }) => remainingMs,
    Wave: () => 0,
    Paused: () => 0,
    Victory: () => 0,
    GameOver: () => 0,
  })

// NOTE: one key on the ring, short of the boards and a pull.
const timedBreak = (current: Model): Model =>
  withKeys(
    modifyFields(current, {
      phase: () =>
        Phase.Preparation({
          wave: 3,
          remainingMs: BREAK_MS,
          durationMs: BREAK_MS,
          spawns: [],
        }),
    }),
    1,
  )

// NOTE: a new save in the break before wave 3, at the kitchen's boards.
const atBoards = (): Model =>
  timedBreak(
    modifyFocus(freshRunModel(), {
      player: player =>
        modifyFields(player, {
          x: () => BELOW_KITCHEN_DOOR.x,
          y: () => BELOW_KITCHEN_DOOR.y,
        }),
    }),
  )

// NOTE: the same break with the kitchen open, at the fridge, its stream
// set so the next draw would be `prize` without the tour's rig.
const atOpenFridge = (prize: FridgePrize): Model => {
  const opened = timedBreak(atFridgeOnWave(3, 5))
  const seed = Option.getOrThrow(
    Array.findFirst(
      Array.makeBy(500, index => index + 1),
      candidate =>
        pickPrize(
          prizeWeights(opened.fridge, focusOf(opened).player),
          nextRandom(candidate).value,
        ) === prize,
    ),
  )
  return modifyFields(opened, {
    loot: loot => modifyFields(loot, { fridgeRngState: () => seed }),
  })
}

const stepOf = (current: Model): Option.Option<KitchenStep> =>
  kitchenStepOf(current)

const isTourRunning = (current: Model): boolean =>
  Tour.isAnyOf(['Running'])(current.kitchenTour)

const isTourDone = (current: Model): boolean =>
  Tour.isAnyOf(['Done'])(current.kitchenTour)

const walkAway = (current: Model): Model =>
  modifyFocus(current, {
    player: player =>
      modifyFields(player, {
        x: () => AT_FRIDGE.x,
        y: () => AT_FRIDGE.y + FRIDGE_RULES.leavePx + 30,
      }),
  })

// NOTE: the Model `steps` leave from `start`, for a test that changes it
// in a way no Message does before it goes on.
const after = (start: Model, ...steps: ReadonlyArray<RootSteps>) =>
  Story.story(APPLICATION, Story.given(start), ...steps)

const frames = (count: number): RootSteps =>
  Story.steps(...ticks(count, FRAME_MS))

describe('the kitchen tour', () => {
  it.effect(
    'holds the clock, gives the kitchen away, and points at the fridge',
    () =>
      Story.story(
        APPLICATION,
        Story.given(atBoards()),
        frames(10),
        Story.model(started => {
          expect(isTourRunning(started)).toBe(true)
          expect(stepOf(started)).toEqual(Option.some('Boards'))
          expect(remainingOf(started)).toBe(BREAK_MS)
          expect(exitPriceFor(started, KITCHEN_EXIT)).toBe(0)
        }),
        holdToBuy,
        Story.model(opened => {
          expect(isKitchenOpen(levelOf(opened))).toBe(true)
          expect(heldKeys(opened)).toBe(1)
          expect(stepOf(opened)).toEqual(Option.some('Fridge'))
        }),
        frames(10),
        Story.model(later => {
          expect(remainingOf(later)).toBe(BREAK_MS)
        }),
      ),
  )

  it.effect.each(['Sandwich', 'Dud', 'Cooker'] as const)(
    'the free pull of a %s stream is always a weapon, from the fridge stream',
    prize =>
      Effect.gen(function* () {
        const start = yield* after(atOpenFridge(prize), frames(1))
        expect(fridgePriceFor(start)).toBe(0)
        return yield* Story.story(
          APPLICATION,
          Story.given(start),
          holdToBuy,
          Story.model(pulled => {
            expect(heldKeys(pulled)).toBe(1)
            expect(pulled.fridge.pulls).toBe(1)
            const door = pulled.fridge.door
            const pulledPrize = FridgeDoor.isAnyOf(['Open', 'Offering'])(door)
              ? door.prize
              : 'Dud'
            expect(isFridgePrizeWeapon(pulledPrize)).toBe(true)
            expect(pulled.loot.fridgeRngState).not.toBe(
              start.loot.fridgeRngState,
            )
            expect(stepOf(pulled)).toEqual(Option.some('Choose'))
          }),
          frames(5),
          Story.model(later => {
            expect(remainingOf(later)).toBe(BREAK_MS)
          }),
        )
      }),
  )

  // NOTE: the free pull made and its door open on the prize.
  const offering = Story.steps(frames(1), holdToBuy, frames(FRIDGE_OPEN_TICKS))

  it.effect('taking the prize ends it, and the clock runs', () =>
    Story.story(
      APPLICATION,
      Story.given(atOpenFridge('Cooker')),
      offering,
      Story.model(offered => {
        expect(FridgeDoor.isAnyOf(['Offering'])(offered.fridge.door)).toBe(true)
      }),
      holdToBuy,
      frames(1),
      Story.model(taken => {
        expect(isTourDone(taken)).toBe(true)
      }),
      frames(10),
      Story.model(later => {
        expect(remainingOf(later)).toBeLessThan(BREAK_MS)
      }),
    ),
  )

  it.effect('walking away from the prize ends it, and the clock runs', () =>
    Effect.gen(function* () {
      const offered = yield* after(atOpenFridge('Pan'), offering)
      return yield* Story.story(
        APPLICATION,
        Story.given(walkAway(offered)),
        frames(3),
        Story.model(left => {
          expect(isTourDone(left)).toBe(true)
        }),
        frames(10),
        Story.model(later => {
          expect(remainingOf(later)).toBeLessThan(BREAK_MS)
        }),
      )
    }),
  )

  it.effect('letting the prize time out ends it, and the clock runs', () =>
    Story.story(
      APPLICATION,
      Story.given(atOpenFridge('Pan')),
      offering,
      frames(OFFER_FRAMES),
      Story.model(sunk => {
        expect(isTourDone(sunk)).toBe(true)
      }),
      frames(10),
      Story.model(later => {
        expect(remainingOf(later)).toBeLessThan(BREAK_MS)
      }),
    ),
  )

  it.effect.each(['Sandwich', 'Dud'] as const)(
    'a %s settled at once counts as trying the fridge',
    prize =>
      Effect.gen(function* () {
        const running = yield* after(atOpenFridge('Cooker'), frames(1))
        const gagged = modifyFields(running, {
          fridge: fridge =>
            modifyFields(fridge, {
              pulls: () => 1,
              door: () =>
                FridgeDoor.Open({
                  prize,
                  slot: soloSeat.slot,
                  remainingMs: FRIDGE_RULES.openMs,
                  durationMs: FRIDGE_RULES.openMs,
                }),
            }),
        })
        expect(isKitchenTourOn(gagged)).toBe(true)
        return yield* Story.story(
          APPLICATION,
          Story.given(gagged),
          frames(FRIDGE_OPEN_TICKS),
          Story.model(shut => {
            expect(isTourDone(shut)).toBe(true)
          }),
          frames(10),
          Story.model(later => {
            expect(remainingOf(later)).toBeLessThan(BREAK_MS)
          }),
        )
      }),
  )

  it.effect('the skip button ends it: the clock runs and prices are back', () =>
    Story.story(
      APPLICATION,
      Story.given(atBoards()),
      frames(2),
      Story.message(Message.ClickedSkipKitchenTourButton()),
      Story.model(skipped => {
        expect(skipped.kitchenTour).toEqual(Tour.Over())
        expect(exitPriceFor(skipped, KITCHEN_EXIT)).toBe(
          exitKeysOf(KITCHEN_EXIT),
        )
      }),
      frames(10),
      Story.model(later => {
        expect(remainingOf(later)).toBeLessThan(BREAK_MS)
      }),
    ),
  )

  it.effect('runs once per save, and a tutorial reset plays it again', () =>
    Effect.gen(function* () {
      const done = asTutorialDone(atBoards())
      expect(isKitchenTourOn(done)).toBe(false)
      expect(exitPriceFor(done, KITCHEN_EXIT)).toBe(exitKeysOf(KITCHEN_EXIT))
      yield* Story.story(
        APPLICATION,
        Story.given(done),
        frames(2),
        Story.model(later => {
          expect(stepOf(later)).toEqual(Option.none())
        }),
        frames(8),
        Story.model(later => {
          expect(remainingOf(later)).toBeLessThan(BREAK_MS)
        }),
      )
      return yield* Story.story(
        APPLICATION,
        Story.given(forgetTutorial(done)),
        frames(2),
        Story.model(reset => {
          expect(isTourRunning(reset)).toBe(true)
        }),
      )
    }),
  )

  it.effect(
    'in co-op it never runs: full prices and the shared clock keeps going',
    () => {
      const crew = modifyFields(atBoards(), {
        party: () => Party.Crew(),
      })
      expect(isKitchenTourOn(crew)).toBe(false)
      expect(exitPriceFor(crew, KITCHEN_EXIT)).toBe(exitKeysOf(KITCHEN_EXIT))
      expect(fridgePriceFor(crew)).toBe(FRIDGE_RULES.keys)
      return Story.story(
        APPLICATION,
        Story.given(crew),
        frames(2),
        Story.model(later => {
          expect(stepOf(later)).toEqual(Option.none())
        }),
      )
    },
  )
})
