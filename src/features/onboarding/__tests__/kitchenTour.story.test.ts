import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import {
  BreakClock,
  FridgeDoor,
  type FridgePrize,
  type Model,
  Party,
  Phase,
  Tour,
} from '#app/model.ts'
import {
  type KitchenStep,
  kitchenStepOf,
} from '#features/onboarding/kitchenTour.ts'
import { forgetTutorial } from '#platform/save/save.ts'
import { FIXED_STEP_MS, KITCHEN_FIRST_WAVE } from '#shared/constants.ts'
import { nextRandom } from '#shared/prng.ts'
import {
  AT_FRIDGE,
  DISTANT_SPAWN,
  atFridgeOnWave,
  freshRunModel,
  withKeys,
} from '#test/model.fixture.ts'
import {
  BELOW_KITCHEN_DOOR,
  FRIDGE_OPEN_TICKS,
  type StoryStep,
  checkModel,
  holdToBuy,
  modelAfter,
  send,
  settleRunCommands,
  steps,
  storyOf,
  ticks,
} from '#test/testing.ts'
import { asTutorialDone } from '#test/veteran.ts'
import {
  FRIDGE_RULES,
  fridgePriceFor,
  isFridgePrizeWeapon,
  pickPrize,
  prizeWeights,
} from '#world/fridge/leftovers.ts'
import { heldKeys } from '#world/keys/keys.ts'
import { isKitchenOpen } from '#world/kitchen/kitchen.ts'
import { levelOf } from '#world/level/arena.ts'
import { EXIT_RULES, KITCHEN_EXIT, exitPriceFor } from '#world/level/exits.ts'
import { WEST_EXIT } from '#world/level/plan.ts'
import { focusOf, modifyFocus, soloSeat } from '#world/party/party.ts'
import { isPending } from '#world/run/lessons.ts'
import { isKitchenTourOn } from '#world/run/tutorialRules.ts'

const FRAME_MS = FIXED_STEP_MS
const OFFER_FRAMES = Math.ceil(FRIDGE_RULES.offerMs / FRAME_MS) + 2
const BREAK_MS = 15_000

const remainingOf = (current: Model): number =>
  Phase.match(current.phase, {
    Ready: () => 0,
    Arriving: () => 0,
    Preparation: ({ remainingMs }) => remainingMs,
    Wave: () => 0,
    Paused: () => 0,
    Escaped: () => 0,
    LeftEarly: () => 0,
    GameOver: () => 0,
  })

const timedBreak = (current: Model): Model =>
  withKeys(
    UiStruct.evolve(current, {
      phase: () =>
        Phase.Preparation({
          clock: BreakClock.Counting(),
          wave: 3,
          remainingMs: BREAK_MS,
          durationMs: BREAK_MS,
          spawns: [],
        }),
    }),
    1,
  )

const atBoards = (): Model =>
  timedBreak(
    modifyFocus(freshRunModel(), {
      player: player =>
        UiStruct.evolve(player, {
          x: () => BELOW_KITCHEN_DOOR.x,
          y: () => BELOW_KITCHEN_DOOR.y,
        }),
    }),
  )

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
  return UiStruct.evolve(opened, {
    loot: loot => UiStruct.evolve(loot, { fridgeRngState: () => seed }),
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
      UiStruct.evolve(player, {
        x: () => AT_FRIDGE.x,
        y: () => AT_FRIDGE.y + FRIDGE_RULES.leavePx + 30,
      }),
  })

const after = (start: Model, ...each: ReadonlyArray<StoryStep>) =>
  modelAfter(start, steps(...each))

const frames = (count: number): StoryStep => ticks(count, FRAME_MS)

const storyFrom = (start: Model, ...each: ReadonlyArray<StoryStep>) =>
  Effect.gen(function* () {
    const s = yield* storyOf(start)
    steps(...each)(s)
  })

describe('the kitchen tour', () => {
  it.effect(
    'holds the clock, gives the kitchen away, and points at the fridge',
    () =>
      storyFrom(
        atBoards(),
        frames(10),
        checkModel(started => {
          expect(isTourRunning(started)).toBe(true)
          expect(stepOf(started)).toEqual(Option.some('Boards'))
          expect(remainingOf(started)).toBe(BREAK_MS)
          expect(exitPriceFor(started, KITCHEN_EXIT)).toBe(0)
          expect(exitPriceFor(started, WEST_EXIT)).toBe(EXIT_RULES.roomKeys[0])
        }),
        holdToBuy,
        checkModel(opened => {
          expect(isKitchenOpen(levelOf(opened))).toBe(true)
          expect(heldKeys(opened)).toBe(1)
          expect(stepOf(opened)).toEqual(Option.some('Fridge'))
        }),
        frames(10),
        checkModel(later => {
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
        yield* storyFrom(
          start,
          holdToBuy,
          checkModel(pulled => {
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
          checkModel(later => {
            expect(remainingOf(later)).toBe(BREAK_MS)
          }),
        )
      }),
  )

  const offering = steps(frames(1), holdToBuy, frames(FRIDGE_OPEN_TICKS))

  it.effect('taking the prize ends it, and the clock runs', () =>
    storyFrom(
      atOpenFridge('Cooker'),
      offering,
      checkModel(offered => {
        expect(FridgeDoor.isAnyOf(['Offering'])(offered.fridge.door)).toBe(true)
      }),
      holdToBuy,
      frames(1),
      checkModel(taken => {
        expect(isTourDone(taken)).toBe(true)
      }),
      frames(10),
      checkModel(later => {
        expect(remainingOf(later)).toBeLessThan(BREAK_MS)
      }),
    ),
  )

  it.effect('walking away from the prize ends it, and the clock runs', () =>
    Effect.gen(function* () {
      const offered = yield* after(atOpenFridge('Pan'), offering)
      yield* storyFrom(
        walkAway(offered),
        frames(3),
        checkModel(left => {
          expect(isTourDone(left)).toBe(true)
        }),
        frames(10),
        checkModel(later => {
          expect(remainingOf(later)).toBeLessThan(BREAK_MS)
        }),
      )
    }),
  )

  it.effect('letting the prize time out ends it, and the clock runs', () =>
    storyFrom(
      atOpenFridge('Pan'),
      offering,
      frames(OFFER_FRAMES),
      checkModel(sunk => {
        expect(isTourDone(sunk)).toBe(true)
      }),
      frames(10),
      checkModel(later => {
        expect(remainingOf(later)).toBeLessThan(BREAK_MS)
      }),
    ),
  )

  it.effect.each(['Sandwich', 'Dud'] as const)(
    'a %s settled at once counts as trying the fridge',
    prize =>
      Effect.gen(function* () {
        const running = yield* after(atOpenFridge('Cooker'), frames(1))
        const gagged = UiStruct.evolve(running, {
          fridge: fridge =>
            UiStruct.evolve(fridge, {
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
        yield* storyFrom(
          gagged,
          frames(FRIDGE_OPEN_TICKS),
          checkModel(shut => {
            expect(isTourDone(shut)).toBe(true)
          }),
          frames(10),
          checkModel(later => {
            expect(remainingOf(later)).toBeLessThan(BREAK_MS)
          }),
        )
      }),
  )

  it.effect('the skip button ends it: the clock runs and prices are back', () =>
    storyFrom(
      atBoards(),
      frames(2),
      send(Message.ClickedSkipKitchenTourButton()),
      checkModel(skipped => {
        expect(skipped.kitchenTour).toEqual(Tour.Over())
        expect(exitPriceFor(skipped, KITCHEN_EXIT)).toBe(EXIT_RULES.kitchenKeys)
      }),
      frames(10),
      checkModel(later => {
        expect(remainingOf(later)).toBeLessThan(BREAK_MS)
      }),
    ),
  )

  it.effect(
    'in a break that waits, starting the wave learns it for the next run',
    () => {
      const waiting = UiStruct.evolve(atBoards(), {
        phase: () =>
          Phase.Preparation({
            wave: KITCHEN_FIRST_WAVE,
            remainingMs: BREAK_MS,
            durationMs: BREAK_MS,
            spawns: [DISTANT_SPAWN],
            clock: BreakClock.Waiting({ elapsedMs: 0 }),
          }),
      })
      return storyFrom(
        waiting,
        frames(2),
        checkModel(started => {
          expect(isTourRunning(started)).toBe(true)
          expect(isPending(started.lessons.timedBreaks)).toBe(true)
        }),
        send(Message.ClickedStartWaveButton()),
        frames(1),
        checkModel(waved => {
          expect(Phase.isAnyOf(['Wave'])(waved.phase)).toBe(true)
          expect(isPending(waved.lessons.timedBreaks)).toBe(false)
          expect(waved.kitchenTour).toEqual(Tour.Over())
        }),
        settleRunCommands,
      )
    },
  )

  it.effect('runs once per save, and a tutorial reset plays it again', () =>
    Effect.gen(function* () {
      const done = asTutorialDone(atBoards())
      expect(isKitchenTourOn(done)).toBe(false)
      expect(exitPriceFor(done, KITCHEN_EXIT)).toBe(EXIT_RULES.kitchenKeys)
      yield* storyFrom(
        done,
        frames(2),
        checkModel(later => {
          expect(stepOf(later)).toEqual(Option.none())
        }),
        frames(8),
        checkModel(later => {
          expect(remainingOf(later)).toBeLessThan(BREAK_MS)
        }),
      )
      yield* storyFrom(
        forgetTutorial(done),
        frames(2),
        checkModel(reset => {
          expect(isTourRunning(reset)).toBe(true)
        }),
      )
    }),
  )

  it.effect(
    'in co-op it never runs: full prices and the shared clock keeps going',
    () => {
      const crew = UiStruct.evolve(atBoards(), {
        party: () => Party.Crew(),
      })
      expect(isKitchenTourOn(crew)).toBe(false)
      expect(exitPriceFor(crew, KITCHEN_EXIT)).toBe(EXIT_RULES.kitchenKeys)
      expect(fridgePriceFor(crew)).toBe(FRIDGE_RULES.keys)
      return storyFrom(
        crew,
        frames(2),
        checkModel(later => {
          expect(stepOf(later)).toEqual(Option.none())
        }),
      )
    },
  )
})
